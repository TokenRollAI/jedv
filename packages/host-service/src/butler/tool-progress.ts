import { TRPCError } from "@trpc/server";

export interface ButlerToolProgress {
	version: 1;
	tool: string;
	callId: string;
	status: "running" | "succeeded" | "failed" | "interrupted";
	startedAt: number;
	updatedAt: number;
	finishedAt?: number;
	elapsedMs: number;
	parametersSummary: string;
	resultSummary?: string;
	error?: string;
	outcomeUnknown?: boolean;
	reused?: boolean;
}

// Never persist arbitrary tool strings: mail, memory, paths and tool errors can
// contain credentials even when their property names look harmless.
export function toolValueSummary(value: unknown): string {
	if (Array.isArray(value)) return `${value.length} items`;
	if (value === null || value === undefined) return "No value";
	if (typeof value === "object") {
		const entries = Object.entries(value);
		const counts = entries
			.filter(
				([key, v]) =>
					/^(?:count|total|limit|updatedCount)$/u.test(key) &&
					typeof v === "number" &&
					Number.isFinite(v),
			)
			.map(([key, v]) => `${key}: ${v}`);
		return counts.length
			? counts.join(", ")
			: `${entries.length} fields (contents omitted)`;
	}
	return `Value returned (${typeof value}; contents omitted)`;
}

export function toolFailureSummary(error: unknown) {
	if (error instanceof TRPCError)
		return `Tool failed (${error.code}). Inspect the target before retrying.`;
	return "Tool input or execution failed. Inspect the target before retrying.";
}

export class ToolObservationInterrupted extends Error {}

export interface ToolProgressClock {
	now: () => number;
	schedule: (callback: () => void, delayMs: number) => () => void;
}

export const scheduleToolProgress: ToolProgressClock["schedule"] = (
	callback,
	ms,
) => {
	const timer = setTimeout(callback, ms);
	timer.unref?.();
	return () => clearTimeout(timer);
};

export async function observeTool<T>(input: {
	progress: ButlerToolProgress;
	write: (progress: ButlerToolProgress) => void;
	run: (signal: AbortSignal) => Promise<T>;
	clock: ToolProgressClock;
	signal: AbortSignal;
	timeoutMs: number;
}): Promise<T> {
	const { progress, clock } = input;
	input.write(progress);
	let cancelTick = () => {};
	let cancelTimeout = () => {};
	let settled = false;
	const execution = new AbortController();
	const update = (patch: Partial<ButlerToolProgress>) => {
		Object.assign(progress, patch, {
			updatedAt: clock.now(),
			elapsedMs: Math.max(0, clock.now() - progress.startedAt),
		});
		input.write(progress);
	};
	const tick = () => {
		if (settled) return;
		update({});
		cancelTick = clock.schedule(tick, 1000);
	};
	let onAbort = () => {};
	try {
		return await new Promise<T>((resolve, reject) => {
			const interrupt = (reason: string) => {
				if (settled) return;
				settled = true;
				execution.abort();
				update({
					status: "interrupted",
					finishedAt: clock.now(),
					error: reason,
					outcomeUnknown: true,
				});
				reject(new ToolObservationInterrupted(reason));
			};
			onAbort = () =>
				interrupt(
					"Host stopped observing the tool; inspect the target before retrying.",
				);
			input.signal.addEventListener("abort", onAbort, { once: true });
			if (input.signal.aborted) {
				onAbort();
				return;
			}
			cancelTick = clock.schedule(tick, 1000);
			cancelTimeout = clock.schedule(
				() =>
					interrupt(
						"Tool timed out; execution may still finish. Inspect the target before retrying.",
					),
				input.timeoutMs,
			);
			Promise.resolve()
				.then(() => {
					if (execution.signal.aborted || input.signal.aborted)
						throw new ToolObservationInterrupted(
							"Observation stopped before tool execution",
						);
					return input.run(execution.signal);
				})
				.then(
					(value) => {
						if (settled) return;
						settled = true;
						update({
							status: "succeeded",
							finishedAt: clock.now(),
							resultSummary: toolValueSummary(value),
						});
						resolve(value);
					},
					(error: unknown) => {
						if (settled) return;
						settled = true;
						update({
							status: "failed",
							finishedAt: clock.now(),
							error: toolFailureSummary(error),
						});
						reject(error);
					},
				);
		});
	} finally {
		cancelTick();
		cancelTimeout();
		input.signal.removeEventListener("abort", onAbort);
	}
}
