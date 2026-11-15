interface RemovalRisk {
	rows: { id: string; dirty: boolean; unpushed: boolean; blocked: boolean }[];
	impact: {
		workspaceId: string;
		runningTerminalCount: number;
		runningAgentCount: number;
	}[];
}
export function removalRiskFingerprint(value: RemovalRisk | undefined): string {
	if (!value) return "unknown";
	return JSON.stringify({
		rows: value.rows
			.map(({ id, dirty, unpushed, blocked }) => ({
				id,
				dirty,
				unpushed,
				blocked,
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
		sessions: value.impact
			.map(({ workspaceId, runningTerminalCount, runningAgentCount }) => ({
				workspaceId,
				runningTerminalCount,
				runningAgentCount,
			}))
			.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId)),
	});
}
