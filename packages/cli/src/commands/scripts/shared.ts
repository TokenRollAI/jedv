import { CLIError } from "@jedv/cli-framework";
import { LOCAL_HOST_NAMESPACE } from "../../lib/local";

export const PROJECT_UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireOrganizationId(): string {
	return LOCAL_HOST_NAMESPACE;
}

export function assertProjectIds(projectIds: string[] | undefined): void {
	const invalidProjectId = projectIds?.find(
		(projectId) => !PROJECT_UUID_PATTERN.test(projectId),
	);
	if (invalidProjectId) {
		throw new CLIError(
			`Invalid project UUID: ${invalidProjectId}`,
			"Pass the project UUID shown by `jedv projects list`.",
		);
	}
}

/** How to read the message after a write, given whether the app picked it up. */
export function desktopSyncNote(refreshed: boolean): string {
	return refreshed
		? "The running desktop app refreshed immediately."
		: "It will apply when the desktop app opens or refocuses with the local workspace active.";
}
