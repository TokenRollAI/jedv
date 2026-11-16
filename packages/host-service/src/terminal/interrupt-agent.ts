import type { NativeInterruptAttempt } from "../terminal-agents/native-interrupt";
import type { TerminalSessionError } from "./terminal";

export type InterruptDeliveryResult =
	| { success: true; interruptConfirmed: true }
	| (TerminalSessionError & { interruptConfirmed?: true });

export interface InterruptExecution {
	prepare(): NativeInterruptAttempt | null;
	current(): boolean;
	foreground(): Promise<boolean>;
	claim(): Promise<{ isValid(): boolean } | null>;
	cancel(): void;
	deliver(
		isValid: () => boolean,
	): Promise<{ success: true } | TerminalSessionError>;
	observe(callback: () => void): () => void;
	signal?: AbortSignal;
	timeoutMs?: number;
	schedule?: (callback: () => void, ms: number) => () => void;
}

/** Called under the terminal's send queue lock; never takes native writer ownership. */
export async function interruptAndDeliver(
	input: InterruptExecution,
): Promise<InterruptDeliveryResult> {
	const attempt = input.prepare();
	const reject = (
		error: string,
		staged = false,
		confirmed = false,
	): InterruptDeliveryResult => ({
		kind: "SESSION_NOT_ACTIVE",
		error,
		...(staged ? { inputStaged: true as const } : {}),
		...(confirmed ? { interruptConfirmed: true as const } : {}),
	});
	if (!attempt)
		return reject(
			"Safe native interruption is unavailable: require a trusted busy Codex session without a protected draft",
		);
	let staged = false;
	let confirmed = false;
	try {
		const current = () =>
			!input.signal?.aborted && input.current() && attempt.isValid();
		if (!current() || !attempt.canDispatch() || !(await input.foreground()))
			return reject(
				"Native Agent foreground identity or interruption permission is no longer valid",
			);
		if (!current() || !attempt.canDispatch())
			return reject("Native interruption was revoked before delivery claim");
		const claim = await input.claim();
		const valid = () => current() && claim?.isValid() === true;
		if (!valid() || !attempt.canDispatch() || !(await input.foreground()))
			return reject("Native interruption was revoked before cancellation");
		if (!valid() || !attempt.markDispatched())
			return reject("Native interruption was revoked before cancellation");
		// A failed socket write may still have reached the PTY. Never replay it.
		staged = true;
		input.cancel();
		confirmed = await new Promise<boolean>((resolve) => {
			let settled = false;
			let stopObserve = () => {};
			let stopTimer = () => {};
			const finish = (value: boolean) => {
				if (settled) return;
				settled = true;
				stopObserve();
				stopTimer();
				input.signal?.removeEventListener("abort", aborted);
				resolve(value);
			};
			const check = () => {
				if (!valid()) finish(false);
				else if (attempt.isConfirmed()) finish(true);
			};
			const aborted = () => finish(false);
			stopObserve = input.observe(check);
			input.signal?.addEventListener("abort", aborted, { once: true });
			stopTimer = (
				input.schedule ??
				((callback, ms) => {
					const timer = setTimeout(callback, ms);
					timer.unref?.();
					return () => clearTimeout(timer);
				})
			)(() => finish(false), input.timeoutMs ?? 5000);
			if (settled) {
				stopObserve();
				stopTimer();
			}
			check();
		});
		if (!confirmed)
			return reject(
				"Cancellation was requested but not confirmed; inspect the Agent before retrying",
				true,
			);
		if (!valid() || !attempt.isConfirmed() || !(await input.foreground()))
			return reject(
				"Cancellation was confirmed but Mail was not submitted; the Agent identity or draft changed",
				true,
				true,
			);
		const result = await input.deliver(() => valid() && attempt.isConfirmed());
		return "success" in result
			? { success: true, interruptConfirmed: true }
			: { ...result, inputStaged: true, interruptConfirmed: true };
	} catch {
		return reject(
			"Native interruption did not complete; inspect the recipient and delivery before retrying",
			staged,
			confirmed,
		);
	} finally {
		attempt.release();
	}
}
