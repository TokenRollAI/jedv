import { mapEventType } from "../events/map-event-type";
import { matchesAgentBinding } from "./matches-agent-binding";
import type { TerminalAgentBinding } from "./types";

export interface NativeInterruptAttempt {
	canDispatch(): boolean;
	markDispatched(): boolean;
	isValid(): boolean;
	isConfirmed(): boolean;
	release(): void;
}

export type NativeInputStatus = "clean" | "manual-input" | "unknown";
export type ManagedNativeLaunch = Pick<
	TerminalAgentBinding,
	"terminalId" | "workspaceId" | "agentId" | "launchId"
>;

interface Observation {
	binding: TerminalAgentBinding;
	sequence: number;
	generation: number;
	draftDirty: boolean;
	dirtyReason?: "manual-input" | "unknown";
	barrierPending: boolean;
}
interface Attempt {
	binding: TerminalAgentBinding;
	sequence: number;
	generation: number;
	dispatched: boolean;
	confirmed: boolean;
}

/** Tracks explicit human interruption separately from automatic idle permits. */
export class NativeInterruptGuard {
	private readonly observations = new Map<string, Observation>();
	private readonly attempts = new Map<string, Attempt>();
	private readonly managedLaunches = new Map<
		string,
		ManagedNativeLaunch & { clean: boolean }
	>();
	constructor(
		private readonly deps: {
			binding: (terminalId: string) => TerminalAgentBinding | undefined;
			working: (binding: TerminalAgentBinding) => boolean;
			watermark: (binding: TerminalAgentBinding) => number | null;
			changed: (terminalId: string) => void;
		},
	) {}

	/** Only the Host's fresh-PTY launch path may register this before any input. */
	registerManagedLaunch(launch: ManagedNativeLaunch): boolean {
		if (
			!launch.launchId ||
			this.observations.has(launch.terminalId) ||
			this.managedLaunches.has(launch.terminalId) ||
			this.deps.binding(launch.terminalId)
		)
			return false;
		if (this.managedLaunches.size >= 256) {
			const oldest = this.managedLaunches.keys().next().value;
			if (oldest !== undefined) this.managedLaunches.delete(oldest);
		}
		this.managedLaunches.set(launch.terminalId, { ...launch, clean: true });
		return true;
	}

	terminalInput(terminalId: string) {
		const pending = this.managedLaunches.get(terminalId);
		if (pending) pending.clean = false;
	}
	forgetManagedLaunch(launch: ManagedNativeLaunch) {
		const pending = this.managedLaunches.get(launch.terminalId);
		if (
			pending &&
			pending.launchId === launch.launchId &&
			pending.workspaceId === launch.workspaceId &&
			pending.agentId === launch.agentId
		)
			this.managedLaunches.delete(launch.terminalId);
	}

	restore(
		binding: TerminalAgentBinding,
		sequence: number,
		barrierPending: boolean,
	) {
		this.observations.set(binding.terminalId, {
			binding,
			sequence,
			generation: 0,
			draftDirty: true,
			dirtyReason: "unknown",
			barrierPending,
		});
	}

	private observation(binding: TerminalAgentBinding): Observation {
		const previous = this.observations.get(binding.terminalId);
		if (previous && matchesAgentBinding(previous.binding, binding))
			return previous;
		if (this.attempts.delete(binding.terminalId))
			this.deps.changed(binding.terminalId);
		const launch = this.managedLaunches.get(binding.terminalId);
		this.managedLaunches.delete(binding.terminalId);
		const managed =
			launch &&
			launch.workspaceId === binding.workspaceId &&
			launch.agentId === binding.agentId &&
			launch.launchId === binding.launchId;
		const current: Observation = {
			binding,
			sequence: 0,
			generation: 0,
			draftDirty: !managed || !launch.clean,
			dirtyReason: managed && !launch.clean ? "manual-input" : "unknown",
			barrierPending: false,
		};
		this.observations.set(binding.terminalId, current);
		return current;
	}

	manualInput(binding: TerminalAgentBinding): number | null {
		this.terminalInput(binding.terminalId);
		const current = this.observation(binding);
		current.generation++;
		current.draftDirty = true;
		current.dirtyReason = "manual-input";
		current.barrierPending = true;
		this.attempts.delete(binding.terminalId);
		this.deps.changed(binding.terminalId);
		const watermark = this.deps.watermark(binding);
		current.barrierPending = watermark === null;
		if (watermark !== null)
			current.sequence = Math.max(current.sequence, watermark);
		return watermark;
	}

	observe(
		binding: TerminalAgentBinding,
		input: {
			eventType: string;
			hook?: { eventType: string; trusted: boolean; sequence?: number };
		},
	) {
		const current = this.observation(binding);
		current.binding = binding;
		// Delayed liveness reports carry no information about the input buffer.
		if (input.eventType === "Attached") return;
		const sequence = input.hook?.sequence ?? 0;
		if (
			!input.hook?.trusted ||
			mapEventType(input.hook.eventType) !== input.eventType ||
			!Number.isSafeInteger(sequence) ||
			sequence <= 0
		) {
			current.draftDirty = true;
			current.dirtyReason ??= "unknown";
			current.generation++;
			this.attempts.delete(binding.terminalId);
			this.deps.changed(binding.terminalId);
			return;
		}
		if (current.barrierPending) {
			const watermark = this.deps.watermark(binding);
			if (watermark === null) return;
			current.sequence = Math.max(current.sequence, watermark, sequence);
			current.barrierPending = false;
			return;
		}
		if (sequence <= current.sequence) return;
		current.sequence = sequence;
		const attempt = this.attempts.get(binding.terminalId);
		const promptSubmitted =
			input.hook.eventType === "UserPromptSubmit" ||
			(input.hook.eventType === "Start" &&
				// Legacy agy PreInvocation and Gemini AfterTool are sent as Start;
				// neither proves that the user submitted the terminal's draft.
				binding.agentId !== "agy" &&
				binding.agentId !== "gemini");
		if (promptSubmitted) {
			current.draftDirty = false;
			current.dirtyReason = undefined;
			current.generation++;
			this.attempts.delete(binding.terminalId);
		} else if (input.hook.eventType === "Interrupt") {
			if (
				attempt?.dispatched &&
				sequence > attempt.sequence &&
				!current.draftDirty &&
				current.generation === attempt.generation &&
				matchesAgentBinding(binding, attempt.binding)
			)
				attempt.confirmed = true;
		} else if (
			input.eventType === "PermissionRequest" ||
			(input.eventType === "Stop" && attempt && !attempt.confirmed) ||
			(input.eventType === "Start" && attempt?.confirmed)
		) {
			this.attempts.delete(binding.terminalId);
		}
		if (attempt) this.deps.changed(binding.terminalId);
	}

	prepare(expected: TerminalAgentBinding): NativeInterruptAttempt | null {
		const current = this.observations.get(expected.terminalId);
		if (
			expected.agentId !== "codex" ||
			!expected.launchId ||
			!expected.agentSessionId ||
			!current ||
			current.draftDirty ||
			current.barrierPending ||
			current.sequence <= 0 ||
			!matchesAgentBinding(current.binding, expected) ||
			!matchesAgentBinding(this.deps.binding(expected.terminalId), expected) ||
			!this.deps.working(expected) ||
			this.deps.watermark(expected) !== current.sequence ||
			this.attempts.has(expected.terminalId)
		)
			return null;
		const attempt: Attempt = {
			binding: expected,
			sequence: current.sequence,
			generation: current.generation,
			dispatched: false,
			confirmed: false,
		};
		this.attempts.set(expected.terminalId, attempt);
		const valid = () => {
			const latest = this.observations.get(expected.terminalId);
			return (
				this.attempts.get(expected.terminalId) === attempt &&
				!!latest &&
				!latest.draftDirty &&
				!latest.barrierPending &&
				latest.generation === attempt.generation &&
				matchesAgentBinding(latest.binding, expected) &&
				matchesAgentBinding(this.deps.binding(expected.terminalId), expected)
			);
		};
		const canDispatch = () =>
			valid() &&
			!attempt.dispatched &&
			this.deps.working(expected) &&
			this.observations.get(expected.terminalId)?.sequence ===
				attempt.sequence &&
			this.deps.watermark(expected) === attempt.sequence;
		return {
			canDispatch,
			markDispatched: () => {
				if (!canDispatch()) return false;
				attempt.dispatched = true;
				return true;
			},
			isValid: valid,
			isConfirmed: () =>
				valid() &&
				attempt.confirmed &&
				this.deps.watermark(expected) ===
					this.observations.get(expected.terminalId)?.sequence,
			release: () => {
				if (this.attempts.get(expected.terminalId) === attempt)
					this.attempts.delete(expected.terminalId);
			},
		};
	}

	/** Shared by explicit interrupts and automatic nudges; tool progress never clears a draft. */
	inputIsClean(expected: TerminalAgentBinding): boolean {
		return this.inputStatus(expected) === "clean";
	}
	inputStatus(expected: TerminalAgentBinding): NativeInputStatus {
		const current = this.observations.get(expected.terminalId);
		if (
			!current ||
			!matchesAgentBinding(current.binding, expected) ||
			!matchesAgentBinding(this.deps.binding(expected.terminalId), expected)
		)
			return "unknown";
		if (current.draftDirty || current.barrierPending)
			return current.dirtyReason ?? "unknown";
		return "clean";
	}

	end(terminalId: string) {
		this.managedLaunches.delete(terminalId);
		this.observations.delete(terminalId);
		this.attempts.delete(terminalId);
		this.deps.changed(terminalId);
	}
}
