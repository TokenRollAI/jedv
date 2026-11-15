export function terminalPaneTitle({
	titleOverride,
	customTitle,
	agentLabel,
	runtimeTitle,
	sessionTitle,
	fallback,
}: {
	titleOverride?: string;
	customTitle?: string | null;
	agentLabel?: string;
	runtimeTitle?: string | null;
	sessionTitle?: string | null;
	fallback: string;
}) {
	const live =
		agentLabel && !customTitle ? agentLabel : (runtimeTitle ?? customTitle);
	return titleOverride ?? live ?? sessionTitle ?? fallback;
}
