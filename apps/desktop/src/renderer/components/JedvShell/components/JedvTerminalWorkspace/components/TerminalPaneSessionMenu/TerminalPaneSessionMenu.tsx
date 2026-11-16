import { errorMessage } from "@jedv/i18n/errors";
import type { RendererContext } from "@jedv/panes";
import { AGENT_IDENTITY_LABELS } from "@jedv/shared/agent-catalog";
import { toast } from "@jedv/ui/sonner";
import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, TerminalSquare } from "lucide-react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import { AgentIcon } from "renderer/components/AgentIcon";
import { terminalRuntimeRegistry } from "renderer/lib/terminal/terminal-runtime-registry";
import { useTerminalSessionsMenu } from "../../../JedvTerminalTabStrip/components/TerminalSessionsMenu/useTerminalSessionsMenu";
import type { TerminalSessionsMenuProps } from "../../../JedvTerminalTabStrip/types";
import {
	paneTerminalId,
	switchTerminalSession,
	type WorkspacePaneData,
} from "../../layout";
import { terminalPaneTitle } from "./terminal-pane-title";

export function TerminalPaneSessionMenu({
	context,
	menuProps,
	onCreated,
	displayAgentId,
	displaySessionName,
}: {
	context: RendererContext<WorkspacePaneData>;
	menuProps: TerminalSessionsMenuProps;
	onCreated(): Promise<void>;
	displayAgentId?: string | null;
	displaySessionName?: string;
}) {
	const { t } = useLingui();
	const cache = useQueryClient();
	const isDark = useIsDarkTheme();
	const paneId = context.pane.id;
	const terminalId = paneTerminalId(
		context.store.getState().getPane(paneId)?.pane,
	);
	const picker = menuProps.sessionPicker;
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const alive = useRef(true);
	const latest = useRef({ picker, terminalId, store: context.store, paneId });
	latest.current = { picker, terminalId, store: context.store, paneId };
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const runtimeTitle = useSyncExternalStore(
		useCallback(
			(listener: () => void) =>
				terminalId
					? terminalRuntimeRegistry.onTitleChange(terminalId, listener, paneId)
					: () => {},
			[terminalId, paneId],
		),
		useCallback(
			() =>
				terminalId
					? terminalRuntimeRegistry.getTitle(terminalId, paneId)
					: undefined,
			[terminalId, paneId],
		),
	);
	const create = async () => {
		if (!picker || busy.current) return;
		const original = latest.current;
		const isCurrent = () =>
			alive.current &&
			original.store === latest.current.store &&
			original.paneId === latest.current.paneId &&
			original.picker?.client === latest.current.picker?.client &&
			original.picker?.hostUrl === latest.current.picker?.hostUrl &&
			original.picker?.workspaceId === latest.current.picker?.workspaceId &&
			paneTerminalId(
				original.store.getState().getPane(original.paneId)?.pane,
			) === original.terminalId;
		if (!isCurrent()) return;
		busy.current = true;
		setPending(true);
		try {
			const created = await picker.client.terminal.createSession.mutate({
				workspaceId: picker.workspaceId,
				themeType: isDark ? "dark" : "light",
			});
			const listing = await picker.client.terminal.list.query({
				workspaceId: picker.workspaceId,
			});
			cache.setQueryData(
				["jedv", picker.hostUrl, "terminals", picker.workspaceId],
				listing,
			);
			const session = listing.sessions.find(
				(row) =>
					row.terminalId === created.terminalId &&
					row.workspaceId === picker.workspaceId,
			);
			if (
				session &&
				isCurrent() &&
				switchTerminalSession(original.store, session, original.paneId)
			)
				menuProps.onAttach(session.terminalId);
			await onCreated();
		} catch (error) {
			if (alive.current) toast.error(errorMessage(error));
		} finally {
			busy.current = false;
			if (alive.current) setPending(false);
		}
	};
	const menu = useTerminalSessionsMenu(
		{
			...menuProps,
			store: context.store,
			targetPaneId: paneId,
			activeId: terminalId,
			enabled: menuProps.enabled && !pending,
			onNew: () => void create(),
		},
		true,
		(session, binding, display) => {
			const agentId = display.bindingFresh
				? (binding?.agentId ?? null)
				: displayAgentId;
			const agentLabel = agentId
				? AGENT_IDENTITY_LABELS[agentId as keyof typeof AGENT_IDENTITY_LABELS]
				: undefined;
			const title = terminalPaneTitle({
				titleOverride: context.store.getState().getPane(paneId)?.pane
					.titleOverride,
				customTitle: session?.customTitle || displaySessionName,
				agentLabel,
				runtimeTitle:
					runtimeTitle !== undefined ? runtimeTitle : session?.title,
				fallback: t({ message: "Terminal" }),
			});
			return (
				<button
					type="button"
					title={title}
					className="flex min-w-0 max-w-96 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onClick={(event) => event.stopPropagation()}
				>
					{agentId ? (
						<AgentIcon presetId={agentId} className="size-3.5" />
					) : (
						<TerminalSquare className="size-3.5 shrink-0" />
					)}
					<span className="min-w-0 truncate">{title}</span>
					<ChevronDown className="size-3 shrink-0" />
				</button>
			);
		},
	);
	return (
		<>
			{menu.menu}
			{menu.dialogs}
		</>
	);
}
