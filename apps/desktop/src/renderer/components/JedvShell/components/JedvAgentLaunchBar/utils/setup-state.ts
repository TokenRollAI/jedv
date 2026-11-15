import type { LocalClient } from "../../../local-client";
export type WorkspaceSetupStatus = Awaited<
	ReturnType<LocalClient["workspaces"]["getSetupStatus"]["query"]>
>;
export function setupAllowsLaunch(state: WorkspaceSetupStatus): boolean {
	return state?.status === "not-required" || state?.status === "succeeded";
}
