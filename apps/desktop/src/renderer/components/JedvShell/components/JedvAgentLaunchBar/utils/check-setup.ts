import { setupAllowsLaunch, type WorkspaceSetupStatus } from "./setup-state";
export async function checkSetupBeforeLaunch({
	readWait,
	readSetup,
	isCurrent,
}: {
	readWait(): Promise<boolean>;
	readSetup(): Promise<WorkspaceSetupStatus>;
	isCurrent(): boolean;
}) {
	const wait = await readWait();
	if (!isCurrent()) return { allowed: false, state: null, stale: true };
	if (!wait) return { allowed: true, state: null, stale: false };
	const state = await readSetup();
	if (!isCurrent()) return { allowed: false, state: null, stale: true };
	return { allowed: setupAllowsLaunch(state), state, stale: false };
}
