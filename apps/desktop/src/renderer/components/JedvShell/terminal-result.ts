import type { QueryClient } from "@tanstack/react-query";
import type { LocalClient } from "./local-client";

export interface TerminalResultContext {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string;
}
export function isCurrentTerminalContext(
	current: TerminalResultContext | null,
	expected: TerminalResultContext,
) {
	return (
		current?.client === expected.client &&
		current.hostUrl === expected.hostUrl &&
		current.workspaceId === expected.workspaceId
	);
}
export async function finishTerminalResult(
	expected: TerminalResultContext,
	terminalId: string | null,
	current: { current: TerminalResultContext | null },
	queryClient: QueryClient,
	select: (terminalId: string | null) => void,
) {
	const key = ["jedv", expected.hostUrl, "terminals", expected.workspaceId];
	await queryClient.cancelQueries({ queryKey: key, exact: true });
	const result = await expected.client.terminal.list.query({
		workspaceId: expected.workspaceId,
	});
	queryClient.setQueryData(key, result);
	if (
		isCurrentTerminalContext(current.current, expected) &&
		(terminalId === null ||
			result.sessions.some((session) => session.terminalId === terminalId))
	)
		select(terminalId);
}
