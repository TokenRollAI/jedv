import { EventEmitter } from "node:events";
import type { BackgroundTask } from "@jedv/chat/protocol";
import type { AgentDefinitionId } from "@jedv/shared/agent-catalog";
import { mapEventType } from "../events/map-event-type";
import { matchesAgentBinding } from "./matches-agent-binding";
import { readSourceSequenceWatermark } from "./source-sequence";
import {
	getSubagentHarness,
	readSubagentTranscript,
	type SubagentTranscriptHint,
} from "./subagent-harnesses";
import type { SubagentTranscript } from "./subagent-transcript";
import { isTrustedTranscriptPath } from "./transcript-path";
import type {
	TerminalAgentBinding,
	TerminalAgentEndReason,
	TerminalAgentId,
	TerminalSubagent,
} from "./types";

interface RecordEventInput {
	/** Only the hook receiver may attest the original event and its token. */
	hook?: { eventType: string; trusted: boolean; sequence?: number };
	launchId?: string;
	account?: TerminalAgentBinding["account"];
	terminalId: string;
	workspaceId: string;
	eventType: string;
	agentId?: TerminalAgentId;
	agentSessionId?: string;
	definitionId?: AgentDefinitionId;
	occurredAt: number;
}

export type AutomaticDeliveryState =
	| "idle"
	| "working"
	| "permission"
	| "interrupted"
	| "cleared"
	| "reserved"
	| "unknown";

export interface AutomaticDeliveryPermit {
	isValid(): boolean;
}

interface AutomaticDeliveryObservation {
	barrierPending?: boolean;
	binding: TerminalAgentBinding;
	state: AutomaticDeliveryState;
	sequence: number;
}

interface RecordSubagentEventInput {
	terminalId: string;
	workspaceId: string;
	/** Raw hook event name (`SubagentStart`, `PostToolUse`, `SubagentStop`, …). */
	eventType: string;
	subagentId: string;
	agentType?: string;
	transcriptPath?: string;
	occurredAt: number;
}

interface RecordSubagentHookInput {
	terminalId: string;
	workspaceId: string;
	/** Raw hook event name from the child. */
	eventType: string;
	subagentId: string;
	agentType?: string;
	hint: SubagentTranscriptHint;
	occurredAt: number;
}

export interface TerminalAgentBindingListFilter {
	agentId?: TerminalAgentId;
	definitionId?: AgentDefinitionId;
}

// "Detached" is the agent's own goodbye (SessionEnd hooks, the codex wrapper
// exit report) — not resumable. "exit"/"error" are terminal-side deaths.
const END_EVENT_REASONS = new Map<string, TerminalAgentEndReason>([
	["Detached", "detached"],
	["exit", "terminal-exited"],
	["error", "terminal-exited"],
]);

/**
 * Hook events can straggle in after the terminal died (async notify
 * callbacks, in-flight curls). Within this window of the recorded end, only
 * clear evidence of a NEW session may revive an ended row — a straggler
 * upsert would erase `endedAt`/`endReason` and destroy the resume candidate.
 */
const END_STRAGGLER_WINDOW_MS = 30_000;

/**
 * A subagent whose SubagentStop never arrived (parent interrupted, hook
 * dropped) must not sit in the roster forever. Live children re-assert on
 * every tool call, so anything quiet this long is gone.
 */
const SUBAGENT_STALE_MS = 10 * 60_000;

/**
 * Finished children stay addressable (their transcript pane may still be
 * open) for this long after their stop, then drop out of memory.
 */
const SUBAGENT_ENDED_RETENTION_MS = 60 * 60_000;

/**
 * The hook endpoint is unauthenticated, so bound what one terminal's roster
 * can hold; the oldest entry makes room for a new child.
 */
const MAX_SUBAGENTS_PER_TERMINAL = 64;

export interface TerminalAgentBindingPersistence {
	load(): TerminalAgentBinding[];
	upsert(binding: TerminalAgentBinding): void;
	delete(terminalId: string): void;
	/**
	 * Retain the row but stamp `endedAt`/`endReason` so the agent session id
	 * survives as a resume candidate. Absent → the store falls back to
	 * deleting (pre-resume behavior).
	 */
	markEnded?(
		terminalId: string,
		reason: TerminalAgentEndReason,
		endedAt?: number,
	): { workspaceId: string } | undefined;
	/** End state of the terminal's row, if it exists and has ended. */
	getEnded?(
		terminalId: string,
	): { endedAt: number; agentSessionId?: string } | undefined;
	/**
	 * Liveness-joined reads (session `active` + workspace-owned). When
	 * provided, the store serves list/find from here so dead-terminal
	 * bindings are unrepresentable; the in-memory map then only backs
	 * `get()` (the fresh-launch wait path).
	 */
	listLiveByWorkspace?(
		workspaceId: string,
		filter?: TerminalAgentBindingListFilter,
	): TerminalAgentBinding[];
	listLive?(): TerminalAgentBinding[];
	findLiveActive?(
		workspaceId: string,
		agentId: TerminalAgentId,
		definitionId?: AgentDefinitionId,
	): TerminalAgentBinding | undefined;
}

/**
 * In-process tracker for which agent is alive in which terminal. Populated
 * by the hook receiver, drained on terminal exit, and optionally restored
 * from host-local persistence across host-service restarts.
 *
 * Emits `"change"` with the affected workspaceId after every mutation.
 */
export class TerminalAgentStore extends EventEmitter {
	private readonly byTerminal = new Map<string, TerminalAgentBinding>();
	// Never restore authority from persisted display state, including Stop.
	private readonly automaticDelivery = new Map<
		string,
		AutomaticDeliveryObservation
	>();
	private readonly chatByTerminal = new Map<string, TerminalAgentBinding>();
	private readonly subagentsByTerminal = new Map<
		string,
		Map<string, TerminalSubagent>
	>();
	private readonly persistence: TerminalAgentBindingPersistence | undefined;
	private readonly readSourceSequence: (
		terminalId: string,
		launchId?: string,
	) => number | null;
	private sourceWatermark(binding: TerminalAgentBinding): number | null {
		try {
			const value = this.readSourceSequence(
				binding.terminalId,
				binding.launchId,
			);
			return value !== null && Number.isSafeInteger(value) && value >= 0
				? value
				: null;
		} catch {
			return null;
		}
	}

	constructor(
		persistence?: TerminalAgentBindingPersistence,
		options: { readSourceSequence?: typeof readSourceSequenceWatermark } = {},
	) {
		super();
		this.persistence = persistence;
		this.readSourceSequence =
			options.readSourceSequence ?? readSourceSequenceWatermark;

		for (const binding of persistence?.load() ?? []) {
			const source = this.sourceWatermark(binding);
			this.byTerminal.set(binding.terminalId, binding);
			this.automaticDelivery.set(binding.terminalId, {
				binding,
				state: "unknown",
				barrierPending: source === null,
				sequence: Math.max(binding.deliverySequence ?? 0, source ?? 0),
			});
		}
	}

	recordEvent(input: RecordEventInput): void {
		const {
			terminalId,
			workspaceId,
			eventType,
			agentId,
			agentSessionId,
			definitionId,
			occurredAt,
		} = input;

		const endReason = END_EVENT_REASONS.get(eventType);
		if (endReason) {
			this.endBinding(terminalId, endReason, occurredAt);
			return;
		}

		const ended = this.persistence?.getEnded?.(terminalId);
		const existing = ended ? undefined : this.byTerminal.get(terminalId);
		if (!agentId && !existing) return;

		// A late event for a dead terminal must not resurrect its ended row
		// (the upsert would clear the resume state). Revive only on a fresh
		// session start, a different agent session id, or an event well past
		// the end (an agent without SessionStart hooks launched later).
		if (
			ended !== undefined &&
			eventType !== "Attached" &&
			(agentSessionId === undefined ||
				agentSessionId === ended.agentSessionId) &&
			occurredAt - ended.endedAt <= END_STRAGGLER_WINDOW_MS
		) {
			return;
		}

		const nextAgentId = agentId ?? existing?.agentId;
		if (!nextAgentId) return;

		// Only inherit identity metadata when agentId hasn't changed; otherwise
		// a swap event that omits agentSessionId/definitionId would inherit the
		// prior agent's values and corrupt definitionId-filtered reads.
		const prior =
			existing !== undefined &&
			existing.agentId === nextAgentId &&
			(!input.launchId ||
				!existing.launchId ||
				input.launchId === existing.launchId)
				? existing
				: undefined;

		const sessionChanged =
			prior !== undefined &&
			agentSessionId !== undefined &&
			prior.agentSessionId !== agentSessionId;

		// A new agent or session in the terminal orphans the old roster.
		if (prior === undefined || sessionChanged) {
			this.subagentsByTerminal.delete(terminalId);
		}

		// "Attached" is a session-liveness signal, not lifecycle progress. The
		// wrapper's launch report is delayed and can land after the session
		// already advanced past it (working, a Stop that makes the row a
		// resume candidate, a surfaced Failed) — keep the prior state unless
		// the event belongs to a different session.
		const preservedLifecycleState =
			eventType === "Attached" && prior !== undefined && !sessionChanged
				? prior.lastEventType
				: undefined;

		const sameProducer =
			prior?.launchId === (input.launchId ?? prior?.launchId);
		const next: TerminalAgentBinding = {
			terminalId,
			workspaceId,
			agentId: nextAgentId,
			agentSessionId: agentSessionId ?? prior?.agentSessionId,
			definitionId: definitionId ?? prior?.definitionId,
			launchId: input.launchId ?? prior?.launchId,
			deliverySequence:
				Math.max(
					sameProducer ? (prior?.deliverySequence ?? 0) : 0,
					input.hook?.trusted && Number.isSafeInteger(input.hook.sequence)
						? (input.hook.sequence ?? 0)
						: 0,
				) || undefined,
			account:
				input.account ??
				(prior && (!sessionChanged || prior.agentSessionId === undefined)
					? prior.account
					: undefined),
			startedAt:
				prior !== undefined && !sessionChanged ? prior.startedAt : occurredAt,
			lastEventAt: occurredAt,
			lastEventType: preservedLifecycleState ?? eventType,
		};

		this.byTerminal.set(terminalId, next);
		this.observeAutomaticDelivery(
			next,
			input,
			preservedLifecycleState !== undefined,
		);
		this.persistence?.upsert(next);
		this.emit("change", workspaceId);
		this.noteActivity(workspaceId);
	}

	private observeAutomaticDelivery(
		binding: TerminalAgentBinding,
		input: RecordEventInput,
		preserved: boolean,
	): void {
		const previous = this.automaticDelivery.get(binding.terminalId);
		const sameAgent =
			previous && matchesAgentBinding(previous.binding, binding);
		if (sameAgent)
			binding.deliverySequence =
				Math.max(binding.deliverySequence ?? 0, previous.sequence) || undefined;
		if (preserved && sameAgent) return;
		const previousSequence = sameAgent ? previous.sequence : 0;
		const sequence = input.hook?.sequence ?? 0;
		const setState = (state: AutomaticDeliveryState) => {
			this.automaticDelivery.set(binding.terminalId, {
				binding,
				state,
				barrierPending: sameAgent && previous.barrierPending,
				sequence:
					input.hook?.trusted && Number.isSafeInteger(sequence) && sequence > 0
						? Math.max(sequence, previousSequence)
						: previousSequence,
			});
		};
		if (input.hook?.eventType === "Interrupt") {
			setState("interrupted");
			return;
		}
		if (
			!input.hook?.trusted ||
			mapEventType(input.hook.eventType) !== input.eventType ||
			!Number.isSafeInteger(sequence) ||
			sequence <= 0
		) {
			setState("unknown");
			return;
		}
		if (sameAgent && previous.barrierPending) {
			const watermark = this.sourceWatermark(binding);
			if (watermark === null) {
				setState("unknown");
				return;
			}
			const floor = Math.max(previousSequence, watermark, sequence);
			binding.deliverySequence = floor;
			this.automaticDelivery.set(binding.terminalId, {
				binding,
				state: "unknown",
				sequence: floor,
			});
			// Recovery sampling cannot also authorize the event that triggered it.
			return;
		}
		if (input.eventType === "PermissionRequest") {
			setState("permission");
			return;
		}
		const fresh = sequence > previousSequence;
		if (input.eventType === "Start" && fresh) {
			setState("working");
		} else if (input.eventType === "Stop") {
			// Stop completes an observed work interval; it cannot create one.
			// Repeated Stop, clear -> Stop, and permission -> Stop never re-arm.
			if (sameAgent && previous.state === "working" && fresh) {
				setState("idle");
			} else if (sameAgent) {
				previous.sequence = Math.max(sequence, previousSequence);
			} else {
				setState("unknown");
			}
		} else if (input.eventType !== "Start") {
			setState("unknown");
		}
	}

	/** An agent did something; the sandbox keepalive listens for this. */
	noteActivity(workspaceId: string): void {
		this.emit("activity", workspaceId);
	}

	recordChatEvent(
		input: RecordEventInput & {
			agentId: TerminalAgentId;
			chatSessionId: string;
		},
	): void {
		const prior = this.chatByTerminal.get(input.terminalId);
		const sameSession =
			prior !== undefined &&
			prior.agentId === input.agentId &&
			(input.agentSessionId === undefined ||
				prior.agentSessionId === undefined ||
				prior.agentSessionId === input.agentSessionId);
		this.chatByTerminal.set(input.terminalId, {
			terminalId: input.terminalId,
			workspaceId: input.workspaceId,
			agentId: input.agentId,
			agentSessionId: input.agentSessionId ?? prior?.agentSessionId,
			account: input.account ?? (sameSession ? prior.account : undefined),
			startedAt: sameSession ? prior.startedAt : input.occurredAt,
			lastEventAt: input.occurredAt,
			lastEventType: input.eventType,
			chatSessionId: input.chatSessionId,
			...(prior?.chatSessionId === input.chatSessionId
				? {
						...(prior.backgroundTasks
							? { backgroundTasks: prior.backgroundTasks }
							: {}),
						...(prior.queuedPrompts
							? { queuedPrompts: prior.queuedPrompts }
							: {}),
					}
				: {}),
		});
		this.emit("change", input.workspaceId);
		this.noteActivity(input.workspaceId);
	}

	updateChat(
		terminalId: string,
		patch: { backgroundTasks?: BackgroundTask[]; queuedPrompts?: number },
	): void {
		const prior = this.chatByTerminal.get(terminalId);
		if (!prior) return;
		const next: TerminalAgentBinding = { ...prior, ...patch };
		if (next.backgroundTasks?.length === 0) delete next.backgroundTasks;
		if (next.queuedPrompts === 0) delete next.queuedPrompts;
		this.chatByTerminal.set(terminalId, next);
		this.emit("change", prior.workspaceId);
	}

	endChat(terminalId: string): void {
		const prior = this.chatByTerminal.get(terminalId);
		if (!prior) return;
		this.chatByTerminal.delete(terminalId);
		this.emit("change", prior.workspaceId);
	}

	getChat(terminalId: string): TerminalAgentBinding | undefined {
		return this.chatByTerminal.get(terminalId);
	}

	hasChat(terminalId: string): boolean {
		return this.chatByTerminal.has(terminalId);
	}

	/**
	 * A hook fired inside a subagent of the terminal's agent. Any event keeps
	 * the child live (lost SubagentStarts self-heal on its next tool call);
	 * a stop drops it. Never touches the parent binding's lifecycle state.
	 */
	recordSubagentEvent(input: RecordSubagentEventInput): void {
		const {
			terminalId,
			workspaceId,
			eventType,
			subagentId,
			agentType,
			transcriptPath,
		} = input;
		const occurredAt = input.occurredAt;
		const roster = this.subagentsByTerminal.get(terminalId);
		const existing = roster?.get(subagentId);

		const harness = getSubagentHarness(
			this.byTerminal.get(terminalId)?.agentId,
		);
		if (harness.isStopEvent(eventType)) {
			if (!existing || existing.endedAt !== undefined) return;
			roster?.set(subagentId, {
				...existing,
				...(transcriptPath ? { transcriptPath } : {}),
				lastEventAt: occurredAt,
				endedAt: occurredAt,
			});
			this.emit("change", workspaceId);
			this.noteActivity(workspaceId);
			return;
		}

		// A child can only run under a live parent; a straggler after the
		// terminal ended must not recreate a roster for it.
		if (!this.byTerminal.has(terminalId)) return;

		const nextType = agentType ?? existing?.agentType;
		const nextPath = transcriptPath ?? existing?.transcriptPath;
		const next: TerminalSubagent = {
			id: subagentId,
			...(nextType ? { agentType: nextType } : {}),
			...(nextPath ? { transcriptPath: nextPath } : {}),
			// A stopped child that speaks again (Codex send_input) is live again.
			startedAt:
				existing && existing.endedAt === undefined
					? existing.startedAt
					: occurredAt,
			lastEventAt: occurredAt,
		};
		if (roster) {
			roster.set(subagentId, next);
			while (roster.size > MAX_SUBAGENTS_PER_TERMINAL) {
				const oldest = roster.keys().next().value;
				if (oldest === undefined) break;
				roster.delete(oldest);
			}
		} else {
			this.subagentsByTerminal.set(terminalId, new Map([[subagentId, next]]));
		}
		this.emit("change", workspaceId);
		this.noteActivity(workspaceId);
	}

	/**
	 * A hook event that fired inside a subagent, straight from the hook
	 * endpoint. The parent binding's harness decides whether the event
	 * belongs to the current session and where the child's transcript
	 * lives; the path is kept only when it passes the trust check, since the
	 * endpoint is unauthenticated. Returns false when the event was dropped.
	 */
	recordSubagentHook(input: RecordSubagentHookInput): boolean {
		const parent = this.byTerminal.get(input.terminalId);
		const harness = getSubagentHarness(parent?.agentId);
		if (
			parent?.agentSessionId &&
			!harness.belongsToParentSession(input.hint, parent.agentSessionId)
		) {
			return false;
		}
		const resolvedPath = harness.resolveTranscriptPath(input.hint);
		const transcriptPath =
			resolvedPath && isTrustedTranscriptPath(resolvedPath)
				? resolvedPath
				: undefined;
		this.recordSubagentEvent({
			terminalId: input.terminalId,
			workspaceId: input.workspaceId,
			eventType: input.eventType,
			subagentId: input.subagentId,
			...(input.agentType ? { agentType: input.agentType } : {}),
			...(transcriptPath ? { transcriptPath } : {}),
			occurredAt: input.occurredAt,
		});
		return true;
	}

	/**
	 * A child's transcript for the pane: the roster entry plus its parsed
	 * transcript, or null when the child is unknown. `transcript` is null
	 * while the child has not flushed its first record.
	 */
	getSubagentTranscript(
		terminalId: string,
		subagentId: string,
	): {
		subagent: TerminalSubagent;
		transcript: SubagentTranscript | null;
	} | null {
		const subagent = this.getSubagent(terminalId, subagentId);
		if (!subagent) return null;
		const harness = getSubagentHarness(
			this.byTerminal.get(terminalId)?.agentId,
		);
		return {
			subagent,
			transcript: subagent.transcriptPath
				? readSubagentTranscript(harness, subagent.transcriptPath)
				: null,
		};
	}

	/**
	 * A child by id, live or recently ended, for the subagent transcript pane.
	 * Only paths the roster recorded are ever read, so the renderer cannot
	 * point the host at an arbitrary file.
	 */
	getSubagent(
		terminalId: string,
		subagentId: string,
	): TerminalSubagent | undefined {
		this.pruneSubagents(terminalId);
		return this.subagentsByTerminal.get(terminalId)?.get(subagentId);
	}

	markTerminalExited(terminalId: string): void {
		this.endBinding(terminalId, "terminal-exited", Date.now());
	}

	/**
	 * A deliberate kill (pane close, CLI kill, resume cleanup). Unlike
	 * markTerminalExited the row never becomes a resume candidate — a session
	 * the user chose to end must not be resurrected by auto-resume.
	 */
	markTerminalDisposed(terminalId: string): void {
		this.endBinding(terminalId, "disposed", Date.now());
	}

	/**
	 * Escape hatch for wedged working/permission state (an agent whose final
	 * Stop hook never fired — interrupts fire no hook at all). Forces the
	 * workspace's bindings (or just `terminalId`'s) to `Stop`, keeping
	 * lastEventAt so seen-gating still resolves to idle. Live agents
	 * re-assert within seconds via their next hook event, so clearing a
	 * genuinely working agent self-corrects.
	 */
	clearWorkspaceStatuses(workspaceId: string, onlyTerminalId?: string): void {
		let changed = false;
		for (const [terminalId, binding] of this.byTerminal) {
			if (binding.workspaceId !== workspaceId) continue;
			if (onlyTerminalId !== undefined && terminalId !== onlyTerminalId)
				continue;
			this.revokeAutomaticDelivery(binding, "cleared");
			const current = this.byTerminal.get(terminalId) ?? binding;
			if (current.lastEventType === "Stop") continue;
			const next: TerminalAgentBinding = { ...current, lastEventType: "Stop" };
			this.byTerminal.set(terminalId, next);
			this.persistence?.upsert(next);
			changed = true;
		}
		for (const [terminalId, binding] of this.chatByTerminal) {
			if (binding.workspaceId !== workspaceId) continue;
			if (onlyTerminalId !== undefined && terminalId !== onlyTerminalId)
				continue;
			if (
				binding.lastEventType === "Stop" ||
				binding.lastEventType === "Failed"
			)
				continue;
			this.chatByTerminal.set(terminalId, {
				...binding,
				lastEventType: "Stop",
			});
			changed = true;
		}
		if (changed) this.emit("change", workspaceId);
	}

	getAutomaticDeliveryState(
		expected: TerminalAgentBinding,
	): AutomaticDeliveryState {
		const observation = this.automaticDelivery.get(expected.terminalId);
		return observation &&
			matchesAgentBinding(this.get(expected.terminalId), expected) &&
			matchesAgentBinding(observation.binding, expected)
			? observation.state
			: "unknown";
	}

	private revokeAutomaticDelivery(
		binding: TerminalAgentBinding,
		state: "unknown" | "cleared",
	): void {
		const previous = this.automaticDelivery.get(binding.terminalId);
		const sequence =
			previous && matchesAgentBinding(previous.binding, binding)
				? previous.sequence
				: (binding.deliverySequence ?? 0);
		const observation: AutomaticDeliveryObservation = {
			binding,
			state,
			sequence,
			barrierPending: true,
		};
		// Revoke even an already-claimed permit before performing local IO.
		this.automaticDelivery.set(binding.terminalId, observation);
		this.emit("manual-input", binding.terminalId);
		const watermark = this.sourceWatermark(binding);
		if (watermark !== null) {
			observation.sequence = Math.max(sequence, watermark);
			observation.barrierPending = false;
		}
		const current = this.byTerminal.get(binding.terminalId);
		if (current && matchesAgentBinding(current, binding)) {
			const next = {
				...current,
				deliverySequence: observation.sequence || undefined,
			};
			this.byTerminal.set(binding.terminalId, next);
			observation.binding = next;
			this.persistence?.upsert(next);
		}
	}
	invalidateAutomaticDelivery(expected: TerminalAgentBinding): void {
		if (!matchesAgentBinding(this.get(expected.terminalId), expected)) return;
		this.revokeAutomaticDelivery(
			this.byTerminal.get(expected.terminalId) ?? expected,
			"unknown",
		);
	}

	/**
	 * Claim once at the send queue head. A failed/uncertain write does not
	 * release the claim: only fresh hook evidence can authorize another send.
	 * Compose with a Mail reservation inside sendAgentMessage.acquireDelivery.
	 */
	acquireAutomaticDelivery(
		expected: TerminalAgentBinding,
	): AutomaticDeliveryPermit | null {
		const current = this.automaticDelivery.get(expected.terminalId);
		if (!current || this.getAutomaticDeliveryState(expected) !== "idle")
			return null;
		const observation: AutomaticDeliveryObservation = {
			binding: expected,
			state: "reserved",
			sequence: current.sequence,
		};
		this.automaticDelivery.set(expected.terminalId, observation);
		return {
			isValid: () =>
				this.automaticDelivery.get(expected.terminalId) === observation &&
				matchesAgentBinding(this.get(expected.terminalId), expected),
		};
	}

	get(terminalId: string): TerminalAgentBinding | undefined {
		if (this.persistence?.getEnded?.(terminalId)) return undefined;
		const binding = this.byTerminal.get(terminalId);
		return binding && this.withRuntimeState(binding);
	}

	listByWorkspace(
		workspaceId: string,
		filter?: TerminalAgentBindingListFilter,
	): TerminalAgentBinding[] {
		const matches = (binding: TerminalAgentBinding) =>
			binding.workspaceId === workspaceId &&
			(!filter?.agentId || binding.agentId === filter.agentId) &&
			(!filter?.definitionId || binding.definitionId === filter.definitionId);
		const chats = [...this.chatByTerminal.values()].filter(matches);
		if (this.persistence?.listLiveByWorkspace) {
			return this.withChats(
				this.persistence
					.listLiveByWorkspace(workspaceId, filter)
					.map((binding) => this.withRuntimeState(binding)),
				chats,
			);
		}
		return this.withChats(
			[...this.byTerminal.values()]
				.filter(matches)
				.map((binding) => this.withRuntimeState(binding)),
			chats,
		);
	}

	list(): TerminalAgentBinding[] {
		const chats = [...this.chatByTerminal.values()];
		if (this.persistence?.listLive) {
			return this.withChats(
				this.persistence
					.listLive()
					.map((binding) => this.withRuntimeState(binding)),
				chats,
			);
		}
		return this.withChats(
			[...this.byTerminal.values()].map((binding) =>
				this.withRuntimeState(binding),
			),
			chats,
		);
	}

	private withChats(
		bindings: TerminalAgentBinding[],
		chats: TerminalAgentBinding[],
	): TerminalAgentBinding[] {
		const terminals = new Set(bindings.map((binding) => binding.terminalId));
		return [
			...bindings,
			...chats.filter((chat) => !terminals.has(chat.terminalId)),
		];
	}

	/**
	 * Attach the terminal's live subagents to a binding read. Stale entries
	 * are dropped here rather than on a timer so the store stays passive.
	 */
	private withRuntimeState(
		binding: TerminalAgentBinding,
	): TerminalAgentBinding {
		const memory = this.byTerminal.get(binding.terminalId);
		if (
			memory?.agentId === binding.agentId &&
			memory.agentSessionId === binding.agentSessionId
		) {
			binding = {
				...binding,
				account: memory.account,
				launchId: memory.launchId,
			};
		}
		const roster = this.pruneSubagents(binding.terminalId);
		if (!roster) return binding;
		const live = [...roster.values()]
			.filter((subagent) => subagent.endedAt === undefined)
			.sort((a, b) => a.startedAt - b.startedAt);
		return live.length > 0 ? { ...binding, subagents: live } : binding;
	}

	/**
	 * Drop children that went quiet without a stop, and ended children past
	 * their retention. Runs on read rather than on a timer so the store stays
	 * passive.
	 */
	private pruneSubagents(
		terminalId: string,
	): Map<string, TerminalSubagent> | undefined {
		const roster = this.subagentsByTerminal.get(terminalId);
		if (!roster) return undefined;
		const now = Date.now();
		for (const [id, subagent] of roster) {
			const expired =
				subagent.endedAt === undefined
					? subagent.lastEventAt < now - SUBAGENT_STALE_MS
					: subagent.endedAt < now - SUBAGENT_ENDED_RETENTION_MS;
			if (expired) roster.delete(id);
		}
		if (roster.size === 0) {
			this.subagentsByTerminal.delete(terminalId);
			return undefined;
		}
		return roster;
	}

	findActive(
		workspaceId: string,
		agentId: TerminalAgentId,
		definitionId?: AgentDefinitionId,
	): TerminalAgentBinding | undefined {
		if (this.persistence?.findLiveActive) {
			return this.persistence.findLiveActive(
				workspaceId,
				agentId,
				definitionId,
			);
		}
		let best: TerminalAgentBinding | undefined;
		for (const binding of this.byTerminal.values()) {
			if (binding.workspaceId !== workspaceId) continue;
			if (binding.agentId !== agentId) continue;
			if (definitionId !== undefined && binding.definitionId !== definitionId)
				continue;
			if (!best || binding.lastEventAt > best.lastEventAt) {
				best = binding;
			}
		}
		return best;
	}

	/**
	 * Drop the binding from the live view. With markEnded persistence the row
	 * is retained (stamped ended) so `agentSessionId` survives for resume;
	 * without it, hard-delete as before.
	 */
	private endBinding(
		terminalId: string,
		reason: TerminalAgentEndReason,
		endedAt: number,
	): void {
		const existing = this.byTerminal.get(terminalId);
		this.byTerminal.delete(terminalId);
		this.automaticDelivery.delete(terminalId);
		this.subagentsByTerminal.delete(terminalId);

		let marked: { workspaceId: string } | undefined;
		if (this.persistence?.markEnded) {
			marked = this.persistence.markEnded(terminalId, reason, endedAt);
		} else if (existing) {
			this.persistence?.delete(terminalId);
		}

		this.emit("ended", terminalId, existing?.launchId);
		const workspaceId = marked?.workspaceId ?? existing?.workspaceId;
		if (workspaceId) this.emit("change", workspaceId);
	}
}
