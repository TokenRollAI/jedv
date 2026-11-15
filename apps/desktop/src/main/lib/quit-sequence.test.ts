import { describe, expect, mock, test } from "bun:test";
import {
	FULL_CLEANUP_TIMEOUT_MS,
	type QuitCleanupDeps,
	runQuitCleanup,
	shouldQuitAfterWindowsClose,
} from "./quit-sequence";

function createHarness(overrides: Partial<QuitCleanupDeps> = {}) {
	const forceExit = mock((_code: number) => {});
	const stopHostServices = mock(() => [101, 102]);
	const stopPtyDaemons = mock(async (_pids: number[]) => {});
	const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
	const deps: QuitCleanupDeps = {
		forceFullCleanup: false,
		stopHostServices,
		stopPtyDaemons,
		disposeTray: () => {},
		forceExit,
		scheduleTimer: (callback, delayMs) => scheduled.push({ callback, delayMs }),
		logError: () => {},
		...overrides,
	};
	return { deps, forceExit, stopHostServices, stopPtyDaemons, scheduled };
}

describe("runQuitCleanup", () => {
	test("a confirmed macOS quit continues when window closure interrupts Electron's quit sequence", async () => {
		const h = createHarness();
		const state = {
			platform: "darwin" as const,
			quitRequested: false,
			preparingUpdateInstall: false,
		};
		expect(shouldQuitAfterWindowsClose(state)).toBe(false);
		state.quitRequested = true;
		if (shouldQuitAfterWindowsClose(state)) await runQuitCleanup(h.deps);
		expect(h.stopHostServices).toHaveBeenCalledTimes(1);
		expect(h.forceExit).toHaveBeenCalledWith(0);
		expect(h.stopPtyDaemons).not.toHaveBeenCalled();
		state.preparingUpdateInstall = true;
		expect(shouldQuitAfterWindowsClose(state)).toBe(false);
	});
	test("an update keeps the native Electron quit path and preserves background PTYs", async () => {
		const h = createHarness({ isUpdateInstalling: true });
		await runQuitCleanup(h.deps);
		expect(h.stopHostServices).toHaveBeenCalled();
		expect(h.stopPtyDaemons).not.toHaveBeenCalled();
		expect(h.forceExit).not.toHaveBeenCalled();
	});
	test("keeps PTY daemons alive on a normal quit", async () => {
		const h = createHarness();
		await runQuitCleanup(h.deps);
		expect(h.stopHostServices).toHaveBeenCalled();
		expect(h.stopPtyDaemons).not.toHaveBeenCalled();
		expect(h.forceExit).toHaveBeenCalledWith(0);
	});

	test("stops PTY daemons for Quit Completely", async () => {
		const h = createHarness({ forceFullCleanup: true });
		await runQuitCleanup(h.deps);
		expect(h.stopPtyDaemons).toHaveBeenCalledWith([101, 102]);
		expect(h.forceExit).toHaveBeenCalledWith(0);
	});

	test("exits when full cleanup exceeds its deadline", async () => {
		const h = createHarness({
			forceFullCleanup: true,
			stopPtyDaemons: () => new Promise(() => {}),
		});
		const done = runQuitCleanup(h.deps);
		expect(h.forceExit).not.toHaveBeenCalled();
		expect(h.scheduled[0].delayMs).toBe(FULL_CLEANUP_TIMEOUT_MS);
		h.scheduled[0].callback();
		await done;
		expect(h.forceExit).toHaveBeenCalledWith(0);
	});

	test("exits if cleanup throws", async () => {
		const h = createHarness({
			stopHostServices: () => {
				throw new Error("boom");
			},
		});
		await runQuitCleanup(h.deps);
		expect(h.forceExit).toHaveBeenCalledWith(0);
	});
});
