import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
	AUTO_NUDGE_WINDOW_MS,
	MAX_AUTO_NUDGE_HOPS,
	MAX_AUTO_NUDGES_PER_WINDOW,
	type MailSendInput,
	type TeamworkActor,
} from "@jedv/shared/teamwork";
import {
	and,
	asc,
	desc,
	eq,
	gt,
	inArray,
	isNull,
	lte,
	or,
	sql,
} from "drizzle-orm";
import { mailDeliveries, mailEvents, teamMembers } from "../db/schema";
import type { PeerService } from "../peers/service";
import {
	fail,
	fingerprint,
	type TeamMember,
	type TeamService,
} from "../teams/service";
import {
	resolveTerminalInterruptExecutable,
	sendAutomaticAgentMessage,
	sendInterruptingAgentMessage,
} from "../terminal/terminal";
import type { TerminalAgentBinding } from "../terminal-agents/types";
import {
	MAIL_POLICY_KEY,
	MAIL_PROCESSING_LEASE_MS,
	mailConsumption,
	mailPolicy,
	mailReceipt,
} from "./policy";

import {
	hasDeliveredWakeBatch,
	prepareWakeBatch,
	recordWakeBatch,
} from "./wake-batch";

export interface MailDependencies {
	now?: () => number;
	sendAutomatic?: typeof sendAutomaticAgentMessage;
	sendInterrupt?: typeof sendInterruptingAgentMessage;
	resolveInterruptExecutable?: (
		member: TeamMember,
		binding: TerminalAgentBinding,
	) => Promise<string | null>;
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
	private budgetTimerDueAt: number | undefined;
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
		team.on("deleted", this.onTeamDeleted);
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
			.set({
				nudgeState: "failed",
				lastError:
					"Host restarted before native cancellation; inspect the recipient and request interruption again explicitly",
			})
			.where(
				and(
					eq(mailDeliveries.nudgeState, "pending"),
					sql`EXISTS (SELECT 1 FROM mail_events WHERE mail_events.id = ${mailDeliveries.eventId} AND json_extract(CASE WHEN json_valid(mail_events.payload_json) THEN mail_events.payload_json ELSE '{}' END,'$._jedvMail.deliveryMode') = 'interrupt')`,
				),
			)
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
		this.team.off("deleted", this.onTeamDeleted);
		this.team.off("bindings", this.onBindings);
		this.team.ctx.terminalAgentStore.off("manual-input", this.onManualInput);
		this.emit("close");
		await this.pumping;
	}
	private onTeamDeleted = (_teamId: string, memberIds: string[]) => {
		for (const id of memberIds) {
			this.dirty.delete(id);
			this.batches.delete(id);
			this.humanEpoch.delete(id);
		}
		this.budgetTimer();
	};
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
			event: { ...event, ...mailPolicy(event) },
			outbox: this.peers?.getForEvent(eventId),
			deliveries: this.team.ctx.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.eventId, eventId))
				.all()
				.map((delivery) => ({
					...delivery,
					...mailConsumption(event, delivery, this.now()),
				})),
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
		const { deliveryMode, requiresAck, ...legacyInput } = input;
		if (
			deliveryMode !== undefined &&
			deliveryMode !== "queue" &&
			deliveryMode !== "interrupt"
		)
			fail("BAD_REQUEST", "Unknown Mail delivery mode");
		if (input.payload && MAIL_POLICY_KEY in input.payload)
			fail("BAD_REQUEST", "Mail policy metadata is reserved");
		const hash = fingerprint({
			...legacyInput,
			...(deliveryMode === "interrupt" ? { deliveryMode } : {}),
			...(requiresAck === false ? { requiresAck } : {}),
			actor: undefined,
			teamId: team.id,
		});
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
			if (deliveryMode === "interrupt") {
				if (sender)
					fail("FORBIDDEN", "Interrupt Mail requires an explicit human action");
				if (input.targetPeer || input.to === "team" || team.status !== "active")
					fail(
						"PRECONDITION_FAILED",
						"Interrupt Mail requires one local member in an active Team",
					);
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
			let interruptTarget: { bindingKey: string; sequence: number } | undefined;
			if (deliveryMode === "interrupt") {
				const recipient =
					recipients[0] ?? fail("BAD_REQUEST", "Mail has no recipients");
				const binding = this.team.binding(recipient);
				const permit =
					recipient.status === "active" && binding
						? this.team.ctx.terminalAgentStore.prepareNativeInterrupt(binding)
						: null;
				if (!permit || !binding?.deliverySequence)
					fail(
						"PRECONDITION_FAILED",
						"Safe interruption is unavailable: require a trusted busy Codex Agent without a protected draft. No mail was queued.",
					);
				permit.release();
				interruptTarget = {
					bindingKey: fingerprint(this.team.expected(recipient)),
					sequence: binding.deliverySequence,
				};
			}
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
			const candidate = sender ? this.batches.get(sender.id) : undefined;
			const inferred =
				candidate &&
				sender &&
				candidate.bindingKey === fingerprint(this.team.expected(sender))
					? candidate
					: undefined;
			const batchId = input.wakeBatchId ?? inferred?.id;
			if (batchId && sender) {
				// Read/ACK changes notification state, not ownership of causal history.
				const batch = tx
					.select({
						hop: mailEvents.hopCount,
						event: { payloadJson: mailEvents.payloadJson },
						delivery: {
							id: mailDeliveries.id,
							wakeBatchId: mailDeliveries.wakeBatchId,
							nudgedAt: mailDeliveries.nudgedAt,
							nudgeState: mailDeliveries.nudgeState,
							inflightToken: mailDeliveries.inflightToken,
						},
					})
					.from(mailDeliveries)
					.innerJoin(mailEvents, eq(mailEvents.id, mailDeliveries.eventId))
					.where(
						and(
							eq(mailEvents.teamId, team.id),
							eq(mailDeliveries.recipientMemberId, sender.id),
							or(
								eq(mailDeliveries.wakeBatchId, batchId),
								sql`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${mailEvents.payloadJson}) THEN ${mailEvents.payloadJson} ELSE '{}' END, '$._jedvMail.wakeBatches') AS delivery_batch, json_each(CASE WHEN delivery_batch.type = 'object' THEN delivery_batch.value ELSE '{}' END, '$.batches') AS notification WHERE delivery_batch.key = ${mailDeliveries.id} AND notification.key = ${batchId})`,
							),
						),
					)
					.all()
					.filter((row) =>
						hasDeliveredWakeBatch(row.event, row.delivery, batchId),
					);
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
					payloadJson: JSON.stringify({
						...input.payload,
						[MAIL_POLICY_KEY]: {
							deliveryMode: deliveryMode ?? "queue",
							requiresAck: requiresAck ?? true,
							interruptTarget,
						},
					}),
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
					input.includeAcked
						? undefined
						: and(
								isNull(mailDeliveries.ackedAt),
								or(
									sql`coalesce(json_extract(CASE WHEN json_valid(${mailEvents.payloadJson}) THEN ${mailEvents.payloadJson} ELSE '{}' END, '$._jedvMail.requiresAck'),1) <> 0`,
									isNull(mailDeliveries.readAt),
								),
							),
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
		return {
			items: items.map((row) => ({
				...row,
				delivery: {
					...row.delivery,
					...mailConsumption(row.event, row.delivery, this.now()),
				},
				event: { ...row.event, ...mailPolicy(row.event) },
			})),
			cursor: items.at(-1)?.delivery.id ?? input.after ?? null,
		};
	}
	consume(input: InboxInput & { deliveryId: string }, ack: boolean) {
		return this.team.ctx.db.transaction(() => this.consumeReceipt(input, ack));
	}
	private consumeReceipt(
		input: InboxInput & { deliveryId: string },
		ack: boolean,
	) {
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
		if (ack && !input.actor)
			fail(
				"FORBIDDEN",
				"Only the current recipient Agent can acknowledge Mail; human inspection does not consume it",
			);
		let event = row.event;
		if (input.actor && recipient) {
			if (!this.team.binding(recipient))
				fail(
					"PRECONDITION_FAILED",
					"A current native Agent binding is required to record Mail consumption",
				);
			const bindingKey = fingerprint(this.team.expected(recipient));
			const receipt =
				row.delivery.readAt === null
					? null
					: mailReceipt(row.event, row.delivery.id);
			if (
				ack &&
				row.delivery.ackedAt === null &&
				(!receipt ||
					receipt.memberId !== recipient.id ||
					receipt.bindingKey !== bindingKey ||
					receipt.processingExpiresAt <= this.now() ||
					row.delivery.readAt === null)
			)
				fail(
					"PRECONDITION_FAILED",
					"Read this delivery from the current recipient Agent before acknowledging it",
				);
			const payload = JSON.parse(row.event.payloadJson ?? "{}");
			const policy = payload[MAIL_POLICY_KEY] ?? mailPolicy(row.event);
			const next = ack
				? { ...receipt, ackedAt: row.delivery.ackedAt ?? this.now() }
				: receipt?.bindingKey === bindingKey &&
						receipt.processingExpiresAt > this.now()
					? receipt
					: {
							memberId: recipient.id,
							bindingKey,
							launchId: recipient.expectedLaunchId,
							readAt: this.now(),
							processingExpiresAt: this.now() + MAIL_PROCESSING_LEASE_MS,
						};
			// Preserve old acknowledged rows without inventing their receipt's author.
			if (!ack || row.delivery.ackedAt === null || receipt)
				payload[MAIL_POLICY_KEY] = {
					...policy,
					receipts: { ...policy.receipts, [row.delivery.id]: next },
				};
			event = { ...event, payloadJson: JSON.stringify(payload) };
			const tx = this.team.ctx.db;
			tx.update(mailEvents)
				.set({ payloadJson: event.payloadJson })
				.where(eq(mailEvents.id, event.id))
				.run();
			tx.update(mailDeliveries)
				.set({
					...(ack
						? { ackedAt: row.delivery.ackedAt ?? this.now() }
						: { readAt: row.delivery.readAt ?? this.now() }),
					...([
						"pending",
						"suppressed_budget",
						"nudged",
						"inflight",
						"not_applicable",
						"failed",
					].includes(row.delivery.nudgeState)
						? { nudgeState: "skipped" as const }
						: {}),
				})
				.where(eq(mailDeliveries.id, input.deliveryId))
				.run();
			this.changed(team.id, row.delivery.recipientMemberId);
		}
		const delivery =
			this.team.ctx.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, input.deliveryId))
				.get() ?? row.delivery;
		return {
			...row,
			event: { ...event, ...mailPolicy(event) },
			delivery: {
				...delivery,
				...mailConsumption(event, delivery, this.now()),
			},
			payload: event.payloadJson
				? (JSON.parse(event.payloadJson) as Record<string, unknown>)
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
				event: { ...event, ...mailPolicy(event) },
				deliveries: this.team.ctx.db
					.select()
					.from(mailDeliveries)
					.where(eq(mailDeliveries.eventId, event.id))
					.all()
					.map((delivery) => ({
						...delivery,
						...mailConsumption(event, delivery, this.now()),
					})),
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
				// A shared timer or restart can precede another delivery's deadline.
				this.budgetTimer();
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
	private pending(memberId: string, interrupt = false) {
		const mode = sql`coalesce(json_extract(CASE WHEN json_valid(${mailEvents.payloadJson}) THEN ${mailEvents.payloadJson} ELSE '{}' END, '$._jedvMail.deliveryMode'),'queue')`;
		return this.team.ctx.db
			.select({ delivery: mailDeliveries })
			.from(mailDeliveries)
			.innerJoin(mailEvents, eq(mailEvents.id, mailDeliveries.eventId))
			.where(
				and(
					eq(mailDeliveries.recipientMemberId, memberId),
					isNull(mailDeliveries.ackedAt),
					interrupt
						? and(
								eq(mailDeliveries.nudgeState, "pending"),
								sql`${mode} = 'interrupt'`,
							)
						: or(
								and(
									eq(mailDeliveries.nudgeState, "pending"),
									sql`${mode} <> 'interrupt'`,
								),
								and(
									eq(mailDeliveries.nudgeState, "nudged"),
									sql`${mailDeliveries.attemptCount} < 2`,
									lte(
										mailDeliveries.nudgedAt,
										this.now() - AUTO_NUDGE_WINDOW_MS,
									),
								),
							),
				),
			)
			.orderBy(asc(mailDeliveries.createdAt), asc(mailDeliveries.id))
			.limit(20)
			.all()
			.map((row) => row.delivery);
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
		if (this.controller.signal.aborted) return;
		const now = this.now();
		const retry = this.team.ctx.db
			.select({
				due: sql<
					number | null
				>`min(CASE WHEN ${mailDeliveries.nudgedAt} + ${AUTO_NUDGE_WINDOW_MS} > ${now} THEN ${mailDeliveries.nudgedAt} + ${AUTO_NUDGE_WINDOW_MS} ELSE ${now + AUTO_NUDGE_WINDOW_MS} END)`,
			})
			.from(mailDeliveries)
			.where(
				and(
					eq(mailDeliveries.nudgeState, "nudged"),
					isNull(mailDeliveries.ackedAt),
					sql`${mailDeliveries.attemptCount}<2`,
					sql`${mailDeliveries.nudgedAt} IS NOT NULL`,
				),
			)
			.get()?.due;
		const blocked = this.team.ctx.db
			.select({ id: mailDeliveries.id })
			.from(mailDeliveries)
			.where(eq(mailDeliveries.nudgeState, "suppressed_budget"))
			.limit(1)
			.get();
		const due = Math.min(
			retry ?? Number.POSITIVE_INFINITY,
			blocked ? now + AUTO_NUDGE_WINDOW_MS : Number.POSITIVE_INFINITY,
		);
		if (!Number.isFinite(due)) {
			this.cancelBudgetTimer?.();
			this.cancelBudgetTimer = undefined;
			this.budgetTimerDueAt = undefined;
			return;
		}
		if (
			this.cancelBudgetTimer &&
			this.budgetTimerDueAt !== undefined &&
			this.budgetTimerDueAt <= due
		)
			return;
		this.cancelBudgetTimer?.();
		this.budgetTimerDueAt = due;
		const callback = () => {
			this.cancelBudgetTimer = undefined;
			this.budgetTimerDueAt = undefined;
			if (this.controller.signal.aborted) return;
			this.team.ctx.db
				.update(mailDeliveries)
				.set({ nudgeState: "pending" })
				.where(eq(mailDeliveries.nudgeState, "suppressed_budget"))
				.run();
			this.start();
		};
		const delay = Math.max(1, due - now);
		this.cancelBudgetTimer = this.deps.schedule
			? this.deps.schedule(callback, delay)
			: (() => {
					const timer = setTimeout(callback, delay);
					timer.unref?.();
					return () => clearTimeout(timer);
				})();
	}

	private async nudgeInterrupt(
		member: TeamMember,
		delivery: typeof mailDeliveries.$inferSelect,
	) {
		const event = this.eventResult(delivery.eventId).event;
		const metadata = JSON.parse(event.payloadJson ?? "{}");
		const target = metadata[MAIL_POLICY_KEY]?.interruptTarget as
			| { bindingKey: string; sequence: number }
			| undefined;
		const token = randomUUID(),
			batchId = randomUUID();
		let claimed = false;
		const current = () =>
			!this.controller.signal.aborted &&
			this.team.team(member.teamId).status === "active" &&
			this.team.member(member.id).status === "active" &&
			fingerprint(this.team.expected(this.team.member(member.id))) ===
				target?.bindingKey &&
			!!this.team.binding(this.team.member(member.id));
		const finish = (
			result: Awaited<ReturnType<typeof sendInterruptingAgentMessage>>,
		) => {
			const success = "success" in result;
			const state = success
				? "nudged"
				: result.inputStaged
					? "uncertain_staged"
					: "failed";
			this.team.ctx.db.transaction((tx) => {
				const notified =
					success && claimed
						? tx
								.select()
								.from(mailDeliveries)
								.where(
									and(
										eq(mailDeliveries.id, delivery.id),
										eq(mailDeliveries.inflightToken, token),
										eq(mailDeliveries.wakeBatchId, batchId),
									),
								)
								.get()
						: undefined;
				tx.update(mailDeliveries)
					.set({
						nudgeState: state,
						inflightToken: null,
						...(success
							? { nudgedAt: this.now(), lastError: null }
							: { lastError: result.error }),
					})
					.where(
						and(
							eq(mailDeliveries.id, delivery.id),
							claimed
								? and(
										eq(mailDeliveries.inflightToken, token),
										state === "uncertain_staged"
											? undefined
											: eq(mailDeliveries.nudgeState, "inflight"),
									)
								: eq(mailDeliveries.nudgeState, "pending"),
						),
					)
					.run();
				tx.update(mailDeliveries)
					.set({ inflightToken: null })
					.where(
						and(
							eq(mailDeliveries.id, delivery.id),
							eq(mailDeliveries.inflightToken, token),
						),
					)
					.run();
				const latest = tx
					.select()
					.from(mailEvents)
					.where(eq(mailEvents.id, event.id))
					.get();
				const metadata = JSON.parse(latest?.payloadJson ?? "{}");
				metadata[MAIL_POLICY_KEY] = {
					...metadata[MAIL_POLICY_KEY],
					interruptOutcome: {
						status: success ? "submitted" : state,
						confirmed: result.interruptConfirmed === true,
						updatedAt: this.now(),
					},
				};
				tx.update(mailEvents)
					.set({
						payloadJson: notified
							? recordWakeBatch(
									{ payloadJson: JSON.stringify(metadata) },
									notified,
									batchId,
									fingerprint(this.team.expected(member)),
									this.now(),
								)
							: JSON.stringify(metadata),
					})
					.where(eq(mailEvents.id, event.id))
					.run();
			});
			if (success) {
				this.batches.set(member.id, {
					id: batchId,
					hop: event.hopCount,
					bindingKey: fingerprint(this.team.expected(member)),
				});
				this.budgetTimer();
			}
			this.changed(member.teamId, member.id);
			this.schedule(member.id);
		};
		const reject = (error: string) =>
			finish({ kind: "SESSION_NOT_ACTIVE", error });
		const expected = this.team.binding(member);
		if (
			event.sourceKind !== "human" ||
			!target ||
			!expected ||
			!current() ||
			expected.deliverySequence !== target.sequence
		)
			return reject(
				"Interrupt request no longer matches the original busy Agent; no cancellation was sent",
			);
		const executable = await (this.deps.resolveInterruptExecutable
			? this.deps.resolveInterruptExecutable(member, expected)
			: resolveTerminalInterruptExecutable(expected)
		).catch(() => null);
		if (!executable)
			return reject(
				"This native executable has no verified safe interruption adapter; no cancellation was sent. Choose queue explicitly.",
			);
		if (
			!current() ||
			this.team.binding(this.team.member(member.id))?.deliverySequence !==
				target.sequence
		)
			return reject(
				"The original busy interval changed before cancellation; request a new interruption explicitly",
			);
		const result = await (
			this.deps.sendInterrupt ?? sendInterruptingAgentMessage
		)({
			terminalId: expected.terminalId,
			workspaceId: expected.workspaceId,
			terminalAgentStore: this.team.ctx.terminalAgentStore,
			expectedAgent: expected,
			expectedExecutable: executable,
			expectedSourceSequence: target.sequence,
			db: this.team.ctx.db,
			eventBus: this.team.ctx.eventBus,
			signal: this.controller.signal,
			submit: true,
			text: `[Jedv Mail ${batchId}] An explicit human interrupt was confirmed. Run jedv mail inbox; read the requested delivery and record its disposition, then explicitly ack only after accepting, rejecting or handling it. ACK is not task completion; report results separately. Preserve prior task context. Reply with --wake-batch ${batchId}.`,
			isDeliveryCurrent: current,
			acquireDelivery: async () =>
				this.team.ctx.db.transaction((tx) => {
					if (!current()) return null;
					const row = tx
						.select()
						.from(mailDeliveries)
						.where(eq(mailDeliveries.id, delivery.id))
						.get();
					if (!row || row.nudgeState !== "pending" || row.ackedAt !== null)
						return null;
					const event = tx
						.select()
						.from(mailEvents)
						.where(eq(mailEvents.id, row.eventId))
						.get();
					if (!event) return null;
					tx.update(mailEvents)
						.set({ payloadJson: prepareWakeBatch(event, row) })
						.where(eq(mailEvents.id, event.id))
						.run();
					tx.update(mailDeliveries)
						.set({
							nudgeState: "inflight",
							inflightToken: token,
							wakeBatchId: batchId,
							attemptCount: sql`${mailDeliveries.attemptCount}+1`,
						})
						.where(eq(mailDeliveries.id, delivery.id))
						.run();
					claimed = true;
					this.changed(member.teamId, member.id);
					return {
						isValid: () =>
							current() &&
							!!this.team.ctx.db
								.select()
								.from(mailDeliveries)
								.where(
									and(
										eq(mailDeliveries.id, delivery.id),
										eq(mailDeliveries.nudgeState, "inflight"),
										eq(mailDeliveries.inflightToken, token),
										isNull(mailDeliveries.ackedAt),
									),
								)
								.get(),
					};
				}),
		}).catch(() => ({
			kind: "SESSION_NOT_ACTIVE" as const,
			error:
				"Interruption transport failed; cancellation may already have been sent. Inspect the recipient before retrying.",
			...(claimed ? { inputStaged: true as const } : {}),
		}));
		finish(result);
	}
	private async nudge(memberId: string) {
		let member = this.team.member(memberId);
		const interrupt = this.pending(member.id, true)[0];
		if (interrupt) {
			await this.nudgeInterrupt(member, interrupt);
			return;
		}
		if (
			member.status !== "active" ||
			this.team.team(member.teamId).status !== "active"
		)
			return;
		if (this.team.binding(member)) {
			const waiting = this.team.ctx.db
				.select({ delivery: mailDeliveries, event: mailEvents })
				.from(mailDeliveries)
				.innerJoin(mailEvents, eq(mailEvents.id, mailDeliveries.eventId))
				.where(
					and(
						eq(mailDeliveries.recipientMemberId, memberId),
						eq(mailDeliveries.nudgeState, "not_applicable"),
						isNull(mailDeliveries.ackedAt),
					),
				)
				.all();
			for (const row of waiting)
				if (mailPolicy(row.event).deliveryMode === "queue")
					this.team.ctx.db
						.update(mailDeliveries)
						.set({
							nudgeState:
								row.event.hopCount >= MAX_AUTO_NUDGE_HOPS
									? "suppressed_hop_limit"
									: "pending",
						})
						.where(eq(mailDeliveries.id, row.delivery.id))
						.run();
		}

		member = this.team.refresh(member);
		const expected = this.team.binding(member);
		if (
			!expected ||
			this.team.ctx.terminalAgentStore.getAutomaticDeliveryState(expected) !==
				"idle"
		)
			return;
		const ignored = this.team.ctx.db
			.select()
			.from(mailDeliveries)
			.where(
				and(
					eq(mailDeliveries.recipientMemberId, memberId),
					eq(mailDeliveries.nudgeState, "nudged"),
					isNull(mailDeliveries.ackedAt),
					sql`${mailDeliveries.attemptCount} >= 2`,
					sql`${mailDeliveries.nudgedAt} < ${expected.lastEventAt}`,
				),
			)
			.all();
		for (const delivery of ignored)
			this.team.ctx.db
				.update(mailDeliveries)
				.set({
					nudgeState: "failed",
					lastError:
						"The recipient finished a turn after two Mail notifications without reading this delivery; inspect the Agent or reassign the task. No content was replayed and no ACK was fabricated.",
				})
				.where(eq(mailDeliveries.id, delivery.id))
				.run();
		if (ignored.length) this.changed(member.teamId, member.id);
		if (!this.pending(member.id).length) return;
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
		const text = `[Jedv Mail ${batchId}] Run jedv mail inbox, then read each delivery and record whether you accepted, rejected or handled it. Explicitly ack requested deliveries only after recording that disposition; ACK is not task completion. Report task results separately. Use the inbox cursor to continue through remaining pages. If this notification repeats, inspect existing read/ack receipts before handling; never repeat completed work. Reply with --wake-batch ${batchId}.`;
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
						for (const delivery of pending) {
							const event = events.find(
								(event) => event.id === delivery.eventId,
							);
							if (event)
								tx.update(mailEvents)
									.set({ payloadJson: prepareWakeBatch(event, delivery) })
									.where(eq(mailEvents.id, event.id))
									.run();
						}
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
		).catch(() => ({
			kind: "SESSION_NOT_ACTIVE" as const,
			error:
				"Delivery transport failed with an unknown outcome; inspect the recipient before retrying",
			inputStaged: true as const,
		}));
		if (!claimed.length) return;
		const success = "success" in result;
		const state = success
			? "nudged"
			: result.inputStaged
				? "uncertain_staged"
				: this.team.member(memberId).status === "active"
					? "pending"
					: "skipped";
		this.team.ctx.db.transaction((tx) => {
			if (success) {
				const notified = tx
					.select({ delivery: mailDeliveries, event: mailEvents })
					.from(mailDeliveries)
					.innerJoin(mailEvents, eq(mailEvents.id, mailDeliveries.eventId))
					.where(
						and(
							inArray(mailDeliveries.id, claimed),
							eq(mailDeliveries.inflightToken, token),
							eq(mailDeliveries.wakeBatchId, batchId),
						),
					)
					.all();
				for (const row of notified)
					tx.update(mailEvents)
						.set({
							payloadJson: recordWakeBatch(
								row.event,
								row.delivery,
								batchId,
								fingerprint(this.team.expected(member)),
								this.now(),
							),
						})
						.where(eq(mailEvents.id, row.event.id))
						.run();
			}
			tx.update(mailDeliveries)
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
						state === "uncertain_staged"
							? undefined
							: eq(mailDeliveries.nudgeState, "inflight"),
					),
				)
				.run();
			tx.update(mailDeliveries)
				.set({ inflightToken: null })
				.where(
					and(
						inArray(mailDeliveries.id, claimed),
						eq(mailDeliveries.inflightToken, token),
					),
				)
				.run();
		});
		if (success) this.budgetTimer();
		if (success)
			this.batches.set(memberId, {
				id: batchId,
				hop,
				bindingKey: fingerprint(this.team.expected(member)),
			});
		this.changed(member.teamId, memberId);
	}
}
