export const FULL_CLEANUP_TIMEOUT_MS = 15_000;

export function shouldQuitAfterWindowsClose({
	platform,
	quitRequested,
	preparingUpdateInstall,
}: {
	platform: NodeJS.Platform;
	quitRequested: boolean;
	preparingUpdateInstall: boolean;
}): boolean {
	return !preparingUpdateInstall && (quitRequested || platform !== "darwin");
}

export interface QuitCleanupDeps {
	/** Tray "Quit Completely": stop background services too. */
	forceFullCleanup: boolean;
	isUpdateInstalling?: boolean;
	/** Returns the pids of the host-services it sent SIGTERM to. */
	stopHostServices: () => number[];
	stopPtyDaemons: (stoppedHostServicePids: number[]) => Promise<void>;
	disposeTray: () => void;
	forceExit: (code: number) => void;
	scheduleTimer?: (callback: () => void, delayMs: number) => void;
	logError?: (message: string, error: unknown) => void;
}

export async function runQuitCleanup(deps: QuitCleanupDeps): Promise<void> {
	const {
		forceFullCleanup,
		isUpdateInstalling = false,
		stopHostServices,
		stopPtyDaemons,
		disposeTray,
		forceExit,
		scheduleTimer = (callback, delayMs) => {
			setTimeout(callback, delayMs);
		},
		logError = (message, error) => console.error(message, error),
	} = deps;

	try {
		const stoppedHostServicePids = stopHostServices();
		if (forceFullCleanup) {
			let settled = false;
			await Promise.race([
				stopPtyDaemons(stoppedHostServicePids).finally(() => {
					settled = true;
				}),
				new Promise<void>((resolve) => {
					scheduleTimer(() => {
						if (!settled) {
							logError(
								"[main] Full cleanup during quit timed out after ms:",
								FULL_CLEANUP_TIMEOUT_MS,
							);
						}
						resolve();
					}, FULL_CLEANUP_TIMEOUT_MS);
				}),
			]);
		}
		disposeTray();
	} catch (error) {
		logError("[main] Cleanup during quit failed:", error);
	}

	if (!isUpdateInstalling) forceExit(0);
}
