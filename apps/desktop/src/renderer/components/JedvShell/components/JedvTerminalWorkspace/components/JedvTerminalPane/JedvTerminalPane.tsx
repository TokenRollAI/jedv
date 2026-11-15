import { type RendererContext, usePaneFocus } from "@jedv/panes";
import { useEffect, useRef, useState } from "react";
import type { LocalClient, LocalConnection } from "../../../../local-client";
import { LocalTerminal } from "../../../LocalTerminal";
import type { WorkspacePaneData } from "../../layout";
export function JedvTerminalPane({
	context,
	terminalId,
	connection,
	workspaceId,
	client,
	remote,
	onOpenFile,
	onOpenUrl,
	onConnectionChange,
	active,
	searchOpen,
	onSearchClose,
	onNewShell,
}: {
	context: RendererContext<WorkspacePaneData>;
	terminalId: string;
	connection: LocalConnection;
	workspaceId: string;
	client: LocalClient;
	remote: boolean;
	onOpenFile(path: string, pinned?: boolean): void;
	onOpenUrl?(
		url: string,
		placement?: "pane" | "newTab" | "external" | "rightPane",
	): void | Promise<void>;
	onConnectionChange(connected: boolean): void;
	active: boolean;
	searchOpen: boolean;
	onSearchClose(): void;
	onNewShell(): Promise<void>;
}) {
	const container = useRef<HTMLDivElement>(null);
	const [connected, setConnected] = useState(false);
	const callback = useRef(onConnectionChange);
	callback.current = onConnectionChange;
	usePaneFocus(() =>
		container.current
			?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
			?.focus(),
	);
	useEffect(() => {
		if (context.isActive) callback.current(connected);
	}, [context.isActive, connected]);
	return (
		<div
			ref={container}
			className="flex min-h-0 min-w-0 flex-1"
			data-jedv-active-terminal={context.isActive ? "true" : undefined}
			onPointerDownCapture={() => context.actions.focus()}
		>
			<LocalTerminal
				connection={connection}
				workspaceId={workspaceId}
				terminalId={terminalId}
				instanceId={context.pane.id}
				active={active}
				searchOpen={searchOpen}
				onSearchClose={onSearchClose}
				onNewShell={onNewShell}
				client={client}
				remote={remote}
				onOpenFile={onOpenFile}
				onOpenUrl={onOpenUrl}
				onConnectionChange={setConnected}
			/>
		</div>
	);
}
