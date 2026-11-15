import type { LocalClient } from "./local-client";
export type Project = Awaited<
	ReturnType<LocalClient["project"]["list"]["query"]>
>[number];
export type Workspace = Awaited<
	ReturnType<LocalClient["workspace"]["list"]["query"]>
>[number];
export type TerminalSession = Awaited<
	ReturnType<LocalClient["terminal"]["list"]["query"]>
>["sessions"][number];
export type NativeState = Awaited<
	ReturnType<LocalClient["terminalAgents"]["queryNativeSession"]["query"]>
>;
export type NativeProvider = "claude" | "codex" | "agy" | "kimi";
export const NATIVE_PROVIDERS: NativeProvider[] = [
	"claude",
	"codex",
	"agy",
	"kimi",
];
export const AGENT_LABELS = {
	claude: "Claude Code",
	codex: "Codex",
	agy: "Antigravity",
	kimi: "Kimi Code",
};
export function focusTerminal() {
	requestAnimationFrame(() => {
		if (
			document.querySelector(
				'[role="dialog"], [role="alertdialog"], [data-inline-edit]',
			)
		)
			return;
		const visible = (selector: string) =>
			Array.from(
				(
					document.querySelector('[data-jedv-focused-area="true"]') ?? document
				).querySelectorAll<HTMLTextAreaElement>(selector),
			).find((element) => element.getClientRects().length > 0);
		(
			visible('[data-jedv-active-terminal="true"] .xterm-helper-textarea') ??
			visible(".jedv-terminal .xterm-helper-textarea")
		)?.focus();
	});
}

export type HostAgentConfig = Awaited<
	ReturnType<LocalClient["settings"]["agentConfigs"]["list"]["query"]>
>[number];
