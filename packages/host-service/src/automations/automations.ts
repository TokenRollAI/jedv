import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { hasFiniteRecurrence, nextOccurrenceAfter } from "@jedv/shared/rrule";
import { TRPCError } from "@trpc/server";
import {
	type Automation,
	type AutomationInput,
	type AutomationRun,
	automationInputSchema,
	automationPatchSchema,
	isActiveRun,
	type RunUpdate,
} from "./schema";
import { AutomationStore } from "./store";

export type AutomationExecutor = (
	definition: Automation,
	run: AutomationRun,
	update: (patch: RunUpdate) => void,
	signal: AbortSignal,
) => Promise<void>;
export type AutomationClock = {
	now(): number;
	setInterval(callback: () => void, ms: number): () => void;
};
const defaultClock: AutomationClock = {
	now: Date.now,
	setInterval(callback, ms) {
		const timer = setInterval(callback, ms);
		timer.unref();
		return () => clearInterval(timer);
	},
};

function nextRun(
	definition: Pick<Automation, "rrule" | "timezone" | "enabled" | "createdAt">,
	now: number,
): number | null {
	try {
		new Intl.DateTimeFormat(undefined, {
			timeZone: definition.timezone,
		}).format(now);
		if (!definition.rrule) return null;
		if (hasFiniteRecurrence(definition.rrule))
			throw new Error("Use a repeating RRULE without COUNT or UNTIL");
		const next = nextOccurrenceAfter({
			rrule: definition.rrule,
			timezone: definition.timezone,
			dtstart: new Date(definition.createdAt),
			after: new Date(now),
		});
		if (!next) throw new Error("RRULE has no future occurrence");
		return definition.enabled ? next.getTime() : null;
	} catch (error) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: error instanceof Error ? error.message : "Invalid schedule",
			cause: error,
		});
	}
}

export class LocalAutomations {
	private readonly store: AutomationStore;
	private readonly clock: AutomationClock;
	private readonly active = new Map<string, AbortController>();
	private stopTimer: (() => void) | undefined;
	private stopped = false;
	private failure: Error | undefined;
	constructor(
		private readonly options: {
			home: string;
			execute: AutomationExecutor;
			clock?: AutomationClock;
		},
	) {
		this.clock = options.clock ?? defaultClock;
		this.store = new AutomationStore(join(options.home, "automations.json"));
		const state = this.store.read();
		let changed = false;
		for (const definition of state.definitions) {
			const next = nextRun(definition, this.clock.now());
			if (next !== definition.nextRunAt) {
				definition.nextRunAt = next;
				changed = true;
			}
		}
		for (const run of state.runs)
			if (isActiveRun(run)) {
				Object.assign(run, {
					status: "interrupted",
					finishedAt: this.clock.now(),
					updatedAt: this.clock.now(),
					error: "Host restarted; prompt was not replayed",
				});
				changed = true;
			}
		if (changed) this.store.write(state);
	}
	start(): void {
		if (!this.stopTimer && !this.stopped)
			this.stopTimer = this.clock.setInterval(() => {
				try {
					this.tick();
				} catch (error) {
					this.failure =
						error instanceof Error ? error : new Error(String(error));
					this.stopTimer?.();
					this.stopTimer = undefined;
					console.error("[automations] scheduler stopped", error);
				}
			}, 30_000);
	}
	private check(): void {
		if (this.failure) throw this.failure;
		if (this.stopped)
			throw new TRPCError({
				code: "SERVICE_UNAVAILABLE",
				message: "Automation scheduler is closed",
			});
	}
	list(): Automation[] {
		this.check();
		return this.store.read().definitions;
	}
	get(id: string): Automation {
		const result = this.list().find((item) => item.id === id);
		if (!result)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Automation not found",
			});
		return result;
	}
	create(input: AutomationInput): Automation {
		this.check();
		const now = this.clock.now();
		const definition: Automation = {
			...automationInputSchema.parse(input),
			id: randomUUID(),
			createdAt: now,
			updatedAt: now,
			nextRunAt: null,
		};
		definition.nextRunAt = nextRun(definition, now);
		const state = this.store.read();
		state.definitions.push(definition);
		this.store.write(state);
		return definition;
	}
	update(id: string, patch: unknown): Automation {
		const current = this.get(id);
		const definition = {
			...current,
			...automationPatchSchema.parse(patch),
			updatedAt: this.clock.now(),
		};
		definition.nextRunAt = nextRun(definition, this.clock.now());
		const state = this.store.read();
		state.definitions = state.definitions.map((item) =>
			item.id === id ? definition : item,
		);
		this.store.write(state);
		return definition;
	}
	remove(id: string): { success: true } {
		this.get(id);
		if (this.active.has(id))
			throw new TRPCError({
				code: "CONFLICT",
				message: "Automation is running",
			});
		const state = this.store.read();
		state.definitions = state.definitions.filter((item) => item.id !== id);
		state.runs = state.runs.filter((run) => run.automationId !== id);
		this.store.write(state);
		return { success: true };
	}
	listRuns(id: string): AutomationRun[] {
		this.get(id);
		return this.store
			.read()
			.runs.filter((run) => run.automationId === id)
			.reverse()
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, 50);
	}
	runNow(id: string): AutomationRun {
		return this.launch(this.get(id), null);
	}
	tick(): void {
		this.check();
		const now = this.clock.now();
		for (const definition of this.list())
			if (
				definition.enabled &&
				definition.nextRunAt !== null &&
				definition.nextRunAt <= now
			) {
				if (this.active.has(definition.id)) {
					const state = this.store.read();
					const current = state.definitions.find(
						(item) => item.id === definition.id,
					);
					if (!current)
						throw new Error("Automation disappeared during scheduling");
					current.nextRunAt = nextRun(current, now);
					this.store.write(state);
				} else this.launch(definition, definition.nextRunAt);
			}
	}
	private launch(
		definition: Automation,
		scheduledAt: number | null,
	): AutomationRun {
		this.check();
		if (this.active.has(definition.id))
			throw new TRPCError({
				code: "CONFLICT",
				message: "Automation is running",
			});
		const now = this.clock.now();
		const run: AutomationRun = {
			id: randomUUID(),
			automationId: definition.id,
			trigger: scheduledAt === null ? "manual" : "schedule",
			scheduledAt,
			status: "starting",
			createdAt: now,
			updatedAt: now,
			finishedAt: null,
			workspaceId:
				definition.target.kind === "workspace"
					? definition.target.workspaceId
					: null,
			terminalId: null,
			chatSessionId: null,
			nativeSessionId: null,
			error: null,
		};
		const state = this.store.read();
		if (scheduledAt !== null) {
			const current = state.definitions.find(
				(item) => item.id === definition.id,
			);
			if (!current) throw new Error("Automation disappeared before dispatch");
			current.nextRunAt = nextRun(definition, now);
		}
		const prior = state.runs
			.filter((item) => item.automationId === definition.id)
			.slice(-49);
		state.runs = [
			...state.runs.filter((item) => item.automationId !== definition.id),
			...prior,
			run,
		];
		this.store.write(state);
		const controller = new AbortController();
		this.active.set(definition.id, controller);
		void this.perform(definition, run, controller);
		return run;
	}
	private updateRun(id: string, patch: Partial<AutomationRun>): void {
		const state = this.store.read();
		const run = state.runs.find((item) => item.id === id);
		if (!run) return;
		Object.assign(run, patch, { updatedAt: this.clock.now() });
		this.store.write(state);
	}
	private async perform(
		definition: Automation,
		run: AutomationRun,
		controller: AbortController,
	): Promise<void> {
		try {
			await this.options.execute(
				definition,
				run,
				(patch) => this.updateRun(run.id, patch),
				controller.signal,
			);
			if (!controller.signal.aborted)
				this.updateRun(run.id, {
					status: "succeeded",
					finishedAt: this.clock.now(),
				});
		} catch (error) {
			try {
				this.updateRun(run.id, {
					status:
						controller.signal.aborted ||
						(error instanceof Error && error.name === "AbortError")
							? "interrupted"
							: "failed",
					finishedAt: this.clock.now(),
					error: error instanceof Error ? error.message : String(error),
				});
			} catch (writeError) {
				this.failure =
					writeError instanceof Error
						? writeError
						: new Error(String(writeError));
				console.error("[automations] cannot record run failure", writeError);
			}
		} finally {
			this.active.delete(definition.id);
		}
	}
	activeChatSessionIds(): string[] {
		return this.store
			.read()
			.runs.flatMap((run) =>
				isActiveRun(run) && run.chatSessionId ? [run.chatSessionId] : [],
			);
	}
	dispose(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.stopTimer?.();
		this.stopTimer = undefined;
		for (const [id, controller] of this.active) {
			controller.abort();
			const run = this.store
				.read()
				.runs.find((item) => item.automationId === id && isActiveRun(item));
			if (run)
				this.updateRun(run.id, {
					status: "interrupted",
					finishedAt: this.clock.now(),
					error: "Host closed; task completion was not observed",
				});
		}
	}
}
