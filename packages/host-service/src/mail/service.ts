import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	AUTO_NUDGE_WINDOW_MS,
	MAX_AUTO_NUDGE_HOPS,
	MAX_AUTO_NUDGES_PER_WINDOW,
	type MailSendInput,
	type TeamworkActor,
} from "@jedv/shared/teamwork";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { mailDeliveries, mailEvents, teamMembers } from "../db/schema";
import type { PeerService } from "../peers/service";
import {
	fail,
	fingerprint,
	type TeamMember,
	type TeamService,
} from "../teams/service";
import { sendAutomaticAgentMessage } from "../terminal/terminal";

export interface MailDependencies {
	now?: () => number;
	sendAutomatic?: typeof sendAutomaticAgentMessage;
	schedule?: (callback: () => void, delayMs: number) => () => void;
}
type InboxInput = {
	teamId?: string;
	actor?: TeamworkActor;
	member?: string;
	includeAcked?: boolean;
	limit?: number;
	after?: string;
};

export class MailService extends EventEmitter {
	peers?: PeerService;
	private readonly now: () => number;
	private readonly dirty = new Set<string>();
	private pumping: Promise<void> | undefined;
	private readonly controller = new AbortController();
	private cancelBudgetTimer: (() => void) | undefined;
	private readonly batches = new Map<
		string,
		{ id: string; hop: number; bindingKey: string }
	>();
	private readonly humanEpoch = new Map<string, number>();
	constructor(
		readonly team: TeamService,
		readonly deps: MailDependencies = {},
	) {
		super();
		this.now = deps.now ?? team.now;
		team.on("change", this.onTeamChange);
		team.on("bindings", this.onBindings);
		team.ctx.terminalAgentStore.on("manual-input", this.onManualInput);
		// A crash can occur on either side of the PTY write; inflight is never replayable.
		team.ctx.db
			.update(mailDeliveries)
			.set({
				nudgeState: "uncertain_staged",
				inflightToken: null,
				lastError:
					"Host restarted during delivery; terminal input may already be staged",
			})
			.where(eq(mailDeliveries.nudgeState, "inflight"))
			.run();
		team.ctx.db
			.update(mailDeliveries)
			.set({ nudgeState: "pending" })
			.where(eq(mailDeliveries.nudgeState, "suppressed_budget"))
			.run();
	}
	async dispose() {
		this.controller.abort();
		this.cancelBudgetTimer?.();
		this.team.off("change", this.onTeamChange);
		this.team.off("bindings", this.onBindings);
		this.team.ctx.terminalAgentStore.off("manual-input", this.onManualInput);
		this.emit("close");
		await this.pumping;
	}
	private onTeamChange = (teamId: string) => {
		for (const member of this.team.members(teamId)) this.schedule(member.id);
	};
	private onBindings = () => {
		for (const member of this.team.ctx.db
			.select()
			.from(teamMembers)
			.where(eq(teamMembers.status, "active"))
			.all()) {
			const binding = this.team.binding(member);
			if (
				binding &&
				this.team.ctx.terminalAgentStore.getAutomaticDeliveryState(binding) ===
					"idle"
			)
				this.batches.delete(member.id);
			this.schedule(member.id);
		}
	};
	private onManualInput = (terminalId: string) => {
		for (const member of this.team.ctx.db
			.select()
			.from(teamMembers)
			.where(eq(teamMembers.terminalId, terminalId))
			.all()) {
			this.batches.delete(member.id);
			this.humanEpoch.set(member.id, this.now());
			this.team.ctx.db
				.update(mailDeliveries)
				.set({ nudgeState: "pending" })
				.where(
					and(
						eq(mailDeliveries.recipientMemberId, member.id),
						eq(mailDeliveries.nudgeState, "suppressed_budget"),
					),
				)
				.run();
		}
	};
	private changed(teamId: string, memberId?: string) {
		this.emit("change", teamId);
		this.team.ctx.eventBus?.broadcastMailChanged?.({
			teamId,
			memberId,
			occurredAt: this.now(),
		});
	}
	private eventResult(eventId: string) {
		const event =
			this.team.ctx.db
				.select()
				.from(mailEvents)
				.where(eq(mailEvents.id, eventId))
				.get() ?? fail("NOT_FOUND", "Mail event not found");
		return {
			event,
			outbox: this.peers?.getForEvent(eventId),
			deliveries: this.team.ctx.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.eventId, eventId))
				.all(),
		};
	}
	send(input: MailSendInput) {
		const team = this.team.resolve(input);
		if (team.status === "archived")
			fail("PRECONDITION_FAILED", "Archived Teams cannot receive new mail");
		const sender = input.actor
			? this.team.resolveActor(input.actor, team.id)
			: undefined;
		const sourceKind = sender ? ("member" as const) : ("human" as const),
			sourceId = sender?.id ?? this.team.ctx.userId ?? "local-human";
		const hash = fingerprint({ ...input, actor: undefined, teamId: team.id });
		const result = this.team.ctx.db.transaction((tx) => {
			const previous = tx
				.select()
				.from(mailEvents)
				.where(
					and(
						eq(mailEvents.teamId, team.id),
						eq(mailEvents.sourceKind, sourceKind),
						eq(mailEvents.sourceId, sourceId),
						eq(mailEvents.dedupeKey, input.dedupeKey),
					),
				)
				.get();
			if (previous) {
				if (previous.requestFingerprint !== hash)
					fail("CONFLICT", "Mail dedupe key already has different content");
				return this.eventResult(previous.id);
			}
			const recipients = input.targetPeer
				? []
				: input.to === "team"
					? this.team
							.members(team.id)
							.filter((m) => m.status === "active" && m.id !== sender?.id)
					: [
							input.to === "leader"
								? (this.team
										.members(team.id)
										.find((m) => m.role === "leader") ??
									fail("NOT_FOUND", "Team leader not found"))
								: this.team.findMember(team.id, input.to),
						];
			if (!recipients.length && !input.targetPeer)
				fail("BAD_REQUEST", "Mail has no recipients");
			let hop = 0;
			const parent = input.replyTo
				? (tx
						.select()
						.from(mailEvents)
						.where(
							and(
								eq(mailEvents.id, input.replyTo),
								eq(mailEvents.teamId, team.id),
							),
						)
						.get() ?? fail("NOT_FOUND", "Reply parent not found in this Team"))
				: undefined;
			if (sender && parent) hop = parent.hopCount + 1;
			const inferred = sender ? this.batches.get(sender.id) : undefined;
			const batchId = input.wakeBatchId ?? inferred?.id;
			if (batchId && sender) {
				const batch = tx
					.select({ hop: mailEvents.hopCount })
					.from(mailDeliveries)
					.innerJoin(mailEvents, eq(mailEvents.id, mailDeliveries.eventId))
					.where(
						and(
							eq(mailDeliveries.recipientMemberId, sender.id),
							eq(mailDeliveries.wakeBatchId, batchId),
							eq(mailDeliveries.nudgeState, "nudged"),
						),
					)
					.all();
				if (!batch.length)
					fail(
						"PRECONDITION_FAILED",
						"Wake batch does not belong to this sender",
					);
				if (
					input.wakeBatchId ||
					inferred?.bindingKey === fingerprint(this.team.expected(sender))
				)
					hop = Math.max(hop, ...batch.map((row) => row.hop + 1));
			}
			const eventId = randomUUID(),
				now = this.now();
			tx.insert(mailEvents)
				.values({
					id: eventId,
					teamId: team.id,
					threadId: parent?.threadId ?? input.threadId ?? eventId,
					replyToEventId: parent?.id,
					wakeBatchId: sender ? batchId : undefined,
					type: input.type,
					sourceKind,
					sourceId,
					dedupeKey: input.dedupeKey,
					requestFingerprint: hash,
					hopCount: hop,
					subject: input.subject,
					body: input.body,
					payloadJson: input.payload ? JSON.stringify(input.payload) : null,
					createdAt: now,
				})
				.run();
			if (input.targetPeer) {
				if (!this.peers)
					fail("PRECONDITION_FAILED", "Peer mail is unavailable on this host");
				this.peers.enqueue(this.eventResult(eventId).event, input);
			}

			for (const recipient of recipients)
				tx.insert(mailDeliveries)
					.values({
						id: randomUUID(),
						eventId,
						recipientMemberId: recipient.id,
						nudgeState:
							recipient.status !== "active" ||
							!["active", "paused"].includes(team.status)
								? "not_applicable"
								: hop >= MAX_AUTO_NUDGE_HOPS
									? "suppressed_hop_limit"
									: "pending",
						createdAt: now,
					})
					.run();
			return this.eventResult(eventId);
		});
		for (const delivery of result.deliveries) {
			if (!sender) {
				this.humanEpoch.set(delivery.recipientMemberId, this.now());
				this.batches.delete(delivery.recipientMemberId);
			}
			this.schedule(delivery.recipientMemberId);
		}
		this.changed(team.id);
		if (input.targetPeer) this.peers?.signal();
		return result;
	}
	notifyExternal(teamId: string, eventId: string) {
		for (const delivery of this.eventResult(eventId).deliveries)
			this.schedule(delivery.recipientMemberId);
		this.changed(teamId);
	}

	private recipient(input: InboxInput): TeamMember | undefined {
		const team = this.team.resolve(input);
		if (input.actor) {
			const member = this.team.resolveActor(input.actor, team.id);
			if (input.member && ![member.name, member.id].includes(input.member))
				fail("FORBIDDEN", "A member may only consume its own inbox");
			return member;
		}
		return input.member
			? this.team.findMember(team.id, input.member)
			: undefined;
	}
	inbox(input: InboxInput) {
		const team = this.team.resolve(input),
			recipient = this.recipient(input);
		const cursor = input.after
			? this.team.ctx.db
					.select()
					.from(mailDeliveries)
					.where(eq(mailDeliveries.id, input.after))
					.get()
			: undefined;
		const items = this.team.ctx.db
			.select({ delivery: mailDeliveries, event: mailEvents })
			.from(mailDeliveries)
			.innerJoin(mailEvents, eq(mailEvents.id, mailDeliveries.eventId))
			.where(
				and(
					eq(mailEvents.teamId, team.id),
					recipient
						? eq(mailDeliveries.recipientMemberId, recipient.id)
						: undefined,
					input.includeAcked ? undefined : isNull(mailDeliveries.ackedAt),
					cursor
						? or(
								gt(mailDeliveries.createdAt, cursor.createdAt),
								and(
									eq(mailDeliveries.createdAt, cursor.createdAt),
									gt(mailDeliveries.id, cursor.id),
								),
							)
						: undefined,
				),
			)
			.orderBy(asc(mailDeliveries.createdAt), asc(mailDeliveries.id))
			.limit(input.limit ?? 100)
			.all();
		return { items, cursor: items.at(-1)?.delivery.id ?? input.after ?? null };
	}
	consume(input: InboxInput & { deliveryId: string }, ack: boolean) {
		const team = this.team.resolve(input),
			recipient = this.recipient(input);
		const row =
			this.team.ctx.db
				.select({ delivery: mailDeliveries, event: mailEvents })
				.from(mailDeliveries)
				.innerJoin(mailEvents, eq(mailEvents.id, mailDeliveries.eventId))
				.where(
					and(
						eq(mailDeliveries.id, input.deliveryId),
						eq(mailEvents.teamId, team.id),
						recipient
							? eq(mailDeliveries.recipientMemberId, recipient.id)
							: undefined,
					),
				)
				.get() ?? fail("NOT_FOUND", "Mail delivery not found in this inbox");
		const set = ack
			? { ackedAt: row.delivery.ackedAt ?? this.now() }
			: { readAt: row.delivery.readAt ?? this.now() };
		this.team.ctx.db
			.update(mailDeliveries)
			.set({
				...set,
				...(row.delivery.nudgeState === "pending" ||
				row.delivery.nudgeState === "suppressed_budget"
					? { nudgeState: "skipped" as const }
					: {}),
			})
			.where(eq(mailDeliveries.id, input.deliveryId))
			.run();
		this.changed(team.id, row.delivery.recipientMemberId);
		const delivery =
			this.team.ctx.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, input.deliveryId))
				.get() ?? row.delivery;
		return {
			...row,
			delivery,
			payload: row.event.payloadJson
				? (JSON.parse(row.event.payloadJson) as Record<string, unknown>)
				: null,
		};
	}
	timeline(input: { teamId?: string; actor?: TeamworkActor; limit?: number }) {
		const team = this.team.resolve(input);
		return this.team.ctx.db
			.select()
			.from(mailEvents)
			.where(eq(mailEvents.teamId, team.id))
			.orderBy(desc(mailEvents.createdAt), desc(mailEvents.id))
			.limit(input.limit ?? 100)
			.all()
			.map((event) => ({
				event,
				deliveries: this.team.ctx.db
					.select()
					.from(mailDeliveries)
					.where(eq(mailDeliveries.eventId, event.id))
					.all(),
			}));
	}
	async watch(
		input: InboxInput & { timeoutMs?: number },
		signal?: AbortSignal,
	) {
		const initial = this.inbox(input);
		if (
			initial.items.length ||
			input.timeoutMs === 0 ||
			signal?.aborted ||
			this.controller.signal.aborted
		)
			return initial;
		const teamId = this.team.resolve(input).id;
		await new Promise<void>((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				this.off("change", changed);
				this.off("close", finish);
				signal?.removeEventListener("abort", finish);
				resolve();
			};
			const changed = (id: string) => {
				if (id === teamId) finish();
			};
			const timer = setTimeout(finish, input.timeoutMs ?? 25_000);
			timer.unref?.();
			this.on("change", changed);
			this.once("close", finish);
			signal?.addEventListener("abort", finish, { once: true });
		});
		return this.inbox(input);
	}
	schedule(memberId: string) {
		if (this.controller.signal.aborted) return;
		this.dirty.add(memberId);
		if (this.pumping) return;
		this.pumping = Promise.resolve()
			.then(async () => {
				while (this.dirty.size && !this.controller.signal.aborted) {
					const ids = [...this.dirty];
					this.dirty.clear();
					await Promise.all(
						ids.map((id) =>
							this.nudge(id).catch((error) =>
								console.error("[mail] nudge failed", {
									memberId: id,
									error: error instanceof Error ? error.message : String(error),
								}),
							),
						),
					);
				}
			})
			.finally(() => {
				this.pumping = undefined;
			});
	}
	async flush() {
		while (this.pumping) await this.pumping;
	}
	start() {
		for (const member of this.team.ctx.db
			.select()
			.from(teamMembers)
			.where(eq(teamMembers.status, "active"))
			.all())
			this.schedule(member.id);
	}
	private pending(memberId: string) {
		return this.team.ctx.db
			.select()
			.from(mailDeliveries)
			.where(
				and(
					eq(mailDeliveries.recipientMemberId, memberId),
					eq(mailDeliveries.nudgeState, "pending"),
					isNull(mailDeliveries.readAt),
					isNull(mailDeliveries.ackedAt),
				),
			)
			.limit(256)
			.all();
	}
	private inBudget(memberId: string) {
		const since = Math.max(
			this.now() - AUTO_NUDGE_WINDOW_MS,
			this.humanEpoch.get(memberId) ?? 0,
		);
		const batches = this.team.ctx.db
			.select({ batch: mailDeliveries.wakeBatchId })
			.from(mailDeliveries)
			.where(
				and(
					eq(mailDeliveries.recipientMemberId, memberId),
					gt(mailDeliveries.nudgedAt, since),
				),
			)
			.all();
		return (
			new Set(batches.map((row) => row.batch).filter(Boolean)).size <
			MAX_AUTO_NUDGES_PER_WINDOW
		);
	}
	private budgetTimer() {
		if (this.cancelBudgetTimer) return;
		const callback = () => {
			this.cancelBudgetTimer = undefined;
			this.team.ctx.db
				.update(mailDeliveries)
				.set({ nudgeState: "pending" })
				.where(eq(mailDeliveries.nudgeState, "suppressed_budget"))
				.run();
			this.start();
		};
		this.cancelBudgetTimer = this.deps.schedule
			? this.deps.schedule(callback, AUTO_NUDGE_WINDOW_MS)
			: (() => {
					const timer = setTimeout(callback, AUTO_NUDGE_WINDOW_MS);
					timer.unref?.();
					return () => clearTimeout(timer);
				})();
	}
	private async nudge(memberId: string) {
		let member = this.team.member(memberId);
		if (
			member.status !== "active" ||
			this.team.team(member.teamId).status !== "active" ||
			!this.pending(member.id).length
		)
			return;
		member = this.team.refresh(member);
		const expected = this.team.binding(member);
		if (
			!expected ||
			this.team.ctx.terminalAgentStore.getAutomaticDeliveryState(expected) !==
				"idle"
		)
			return;
		if (!this.inBudget(memberId)) {
			this.team.ctx.db
				.update(mailDeliveries)
				.set({
					nudgeState: "suppressed_budget",
					lastError:
						"Automatic nudge rate budget reached; waiting for the window or human input",
				})
				.where(
					and(
						eq(mailDeliveries.recipientMemberId, memberId),
						eq(mailDeliveries.nudgeState, "pending"),
					),
				)
				.run();
			this.budgetTimer();
			this.changed(member.teamId, member.id);
			return;
		}
		const batchId = randomUUID(),
			token = randomUUID();
		let claimed: string[] = [],
			hop = 0;
		const text = `[Jedv Mail ${batchId}] Run jedv mail inbox, then read and explicitly ack each completed delivery. Reply with --wake-batch ${batchId}.`;
		const valid = () =>
			!this.controller.signal.aborted &&
			this.team.team(member.teamId).status === "active" &&
			this.team.member(memberId).status === "active" &&
			!!this.team.binding(this.team.member(memberId)) &&
			claimed.length > 0 &&
			this.team.ctx.db
				.select()
				.from(mailDeliveries)
				.where(
					and(
						inArray(mailDeliveries.id, claimed),
						eq(mailDeliveries.nudgeState, "inflight"),
						eq(mailDeliveries.inflightToken, token),
						isNull(mailDeliveries.readAt),
						isNull(mailDeliveries.ackedAt),
					),
				)
				.all().length === claimed.length;
		const result = await (this.deps.sendAutomatic ?? sendAutomaticAgentMessage)(
			{
				terminalId: expected.terminalId,
				workspaceId: expected.workspaceId,
				terminalAgentStore: this.team.ctx.terminalAgentStore,
				expectedAgent: expected,
				db: this.team.ctx.db,
				eventBus: this.team.ctx.eventBus,
				signal: this.controller.signal,
				text,
				submit: true,
				acquireDelivery: async () =>
					this.team.ctx.db.transaction((tx) => {
						if (
							this.team.team(member.teamId).status !== "active" ||
							this.team.member(memberId).status !== "active" ||
							!this.team.binding(this.team.member(memberId)) ||
							!this.inBudget(memberId)
						)
							return null;
						const pending = this.pending(memberId);
						if (!pending.length) return null;
						claimed = pending.map((row) => row.id);
						const events = tx
							.select()
							.from(mailEvents)
							.where(
								inArray(
									mailEvents.id,
									pending.map((row) => row.eventId),
								),
							)
							.all();
						hop = Math.max(0, ...events.map((e) => e.hopCount));
						tx.update(mailDeliveries)
							.set({
								nudgeState: "inflight",
								inflightToken: token,
								wakeBatchId: batchId,
								attemptCount: sql`${mailDeliveries.attemptCount} + 1`,
							})
							.where(inArray(mailDeliveries.id, claimed))
							.run();
						return { isValid: valid };
					}),
			},
		);
		if (!claimed.length) return;
		const success = "success" in result;
		const state = success
			? "nudged"
			: result.inputStaged
				? "uncertain_staged"
				: this.team.member(memberId).status === "active"
					? "pending"
					: "skipped";
		this.team.ctx.db
			.update(mailDeliveries)
			.set({
				nudgeState: state,
				inflightToken: null,
				...(success
					? { nudgedAt: this.now(), lastError: null }
					: { lastError: result.error }),
			})
			.where(
				and(
					inArray(mailDeliveries.id, claimed),
					eq(mailDeliveries.inflightToken, token),
				),
			)
			.run();
		if (success)
			this.batches.set(memberId, {
				id: batchId,
				hop,
				bindingKey: fingerprint(this.team.expected(member)),
			});
		this.changed(member.teamId, memberId);
	}
}
