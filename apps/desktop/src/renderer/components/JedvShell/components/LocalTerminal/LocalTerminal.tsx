import "@xterm/xterm/css/xterm.css";
import { useIsTabVisible } from "@jedv/panes";
import { Button } from "@jedv/ui/button";
import { toast } from "@jedv/ui/sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminalAppearance } from "renderer/hooks/useTerminalAppearance";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { writeTerminalClipboard } from "renderer/lib/terminal/terminal-clipboard";
import {
	type LinkHoverInfo,
	terminalRuntimeRegistry as registry,
} from "renderer/lib/terminal/terminal-runtime-registry";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useSettings } from "renderer/stores/settings";
import type { LocalClient } from "../../local-client";
import { hostBaseUrl, type LocalConnection } from "../../local-client";
import { ConnectionPill } from "../ConnectionPill";
import type { LinkAction } from "../JedvFilesView/utils/link-policy";
import { shellEscapePaths, uploadTerminalAttachments } from "./attachments";
import { ScrollToBottomButton } from "./components/ScrollToBottomButton";
import { TerminalLinkHover } from "./components/TerminalLinkHover";
import { TerminalNarrowedBanner } from "./components/TerminalNarrowedBanner";
import { TerminalSearch } from "./components/TerminalSearch";
import {
	openTerminalLink,
	resolveTerminalLinkAction,
	type TerminalLinkAction,
	type TerminalLinkHandlers,
} from "./link-actions";
import { createTerminalLinkMenu } from "./link-menu";
import { terminalContextMenuLinkStore } from "./links";

export function LocalTerminal({
	connection,
	workspaceId,
	terminalId,
	instanceId = terminalId,
	onConnectionChange,
	client,
	onOpenFile,
	onOpenUrl,
	remote = false,
	active = true,
	searchOpen = false,
	onSearchClose,
	onNewShell,
}: {
	connection: LocalConnection;
	workspaceId: string;
	terminalId: string;
	instanceId?: string;
	onConnectionChange?(connected: boolean): void;
	client?: LocalClient;
	onOpenFile?(path: string, pinned?: boolean): void;
	onOpenUrl?(url: string, placement?: LinkAction): void | Promise<void>;
	remote?: boolean;
	active?: boolean;
	searchOpen?: boolean;
	onSearchClose?(): void;
	onNewShell?(): Promise<void>;
}) {
	const { t } = useLingui();
	const copySetting = electronTrpc.settings.getTerminalCopyOnSelect.useQuery();
	const urlLinks = useSettings((state) => state.urlLinks);
	const fileLinks = useSettings((state) => state.fileLinks);
	const folderLinks = useSettings((state) => state.folderLinks);
	const sidebarFileLinks = useSettings((state) => state.sidebarFileLinks);
	const linkSettings = { urlLinks, fileLinks, folderLinks, sidebarFileLinks };
	const linkHandlers: TerminalLinkHandlers = {
		remote,
		onOpenFile,
		onOpenUrl,
		openEditor: (path, line, column) =>
			electronTrpcClient.external.openFileInEditor.mutate({
				path,
				line,
				column,
			}),
		openFinder: (path) => electronTrpcClient.external.openInFinder.mutate(path),
		openExternalUrl: (url) => electronTrpcClient.external.openUrl.mutate(url),
	};
	const cap = electronTrpc.settings.getTerminalParkedRuntimeCap.useQuery();
	const current = useRef({
		copyOnSelect: copySetting.data ?? false,
		linkSettings,
		linkHandlers,
		client,
		onOpenFile,
		onOpenUrl,
		remote,
		onConnectionChange,
	});
	current.current = {
		copyOnSelect: copySetting.data ?? false,
		linkSettings,
		linkHandlers,
		client,
		onOpenFile,
		onOpenUrl,
		remote,
		onConnectionChange,
	};
	const container = useRef<HTMLDivElement>(null);
	const hovered = useRef<LinkHoverInfo | null>(null);
	const [linkHover, setLinkHover] = useState<{
		link: LinkHoverInfo;
		x: number;
		y: number;
	} | null>(null);
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const keepHover = useCallback(() => {
		if (hoverTimer.current) clearTimeout(hoverTimer.current);
		hoverTimer.current = null;
	}, []);
	const closeHover = useCallback(() => {
		keepHover();
		setLinkHover(null);
	}, [keepHover]);
	const leaveHover = useCallback(() => {
		keepHover();
		hoverTimer.current = setTimeout(() => setLinkHover(null), 180);
	}, [keepHover]);
	const runLinkAction = useCallback(
		(
			link: LinkHoverInfo,
			action: TerminalLinkAction,
			handlers = current.current.linkHandlers,
		) => {
			void openTerminalLink(link, action, handlers).catch((error) =>
				toast.error(String(error)),
			);
		},
		[],
	);
	const linkMenu = useCallback(
		(link: LinkHoverInfo) => {
			const { linkHandlers: handlers, linkSettings: settings } =
				current.current;
			return createTerminalLinkMenu({
				link,
				settings,
				handlers,
				onAction: (action) => runLinkAction(link, action, handlers),
				onOpenIn: (app) => {
					if (handlers.remote || link.kind !== "file" || !link.resolvedPath)
						return;
					void electronTrpcClient.external.openInApp
						.mutate({ path: link.resolvedPath, app })
						.catch((error) => toast.error(String(error)));
				},
			});
		},
		[runLinkAction],
	);
	const alive = useRef(false);
	const tabVisible = useIsTabVisible();
	const visible = active && tabVisible;
	const appearance = useTerminalAppearance();
	const appearanceRef = useRef(appearance);
	appearanceRef.current = appearance;
	const [revision, setRevision] = useState(0);
	const [copied, setCopied] = useState(false);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [dropping, setDropping] = useState(false);
	const [pending, setPending] = useState(false);
	const baseUrl = hostBaseUrl(connection);
	useEffect(() => {
		if (cap.data !== undefined) registry.setParkedRuntimeCap(cap.data);
	}, [cap.data]);
	useEffect(() => {
		const dismiss = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeHover();
		};
		window.addEventListener("keydown", dismiss);
		window.addEventListener("blur", closeHover);
		return () => {
			window.removeEventListener("keydown", dismiss);
			window.removeEventListener("blur", closeHover);
			keepHover();
		};
	}, [closeHover, keepHover]);
	useEffect(
		() => registry.updateAppearance(terminalId, appearance, instanceId),
		[terminalId, instanceId, appearance],
	);
	useEffect(() => {
		if (!visible || !container.current) return;
		alive.current = true;
		registry.mount(
			terminalId,
			container.current,
			appearanceRef.current,
			instanceId,
		);
		const terminal = registry.getTerminal(terminalId, instanceId);
		const changed = () => {
			setRevision((value) => value + 1);
			current.current.onConnectionChange?.(
				registry.getConnectionState(terminalId, instanceId) === "open",
			);
			if (registry.isSessionEnded(terminalId, instanceId))
				registry.persistEndedSession(terminalId, instanceId);
		};
		const disposeState = registry.onStateChange(
			terminalId,
			changed,
			instanceId,
		);
		const disposeLogs = registry.onLogsChange(
			terminalId,
			() => setRevision((value) => value + 1),
			instanceId,
		);
		const selection = terminal?.onSelectionChange(() => {
			if (!current.current.copyOnSelect) return;
			const text = registry.getSelection(terminalId, instanceId);
			if (text)
				void writeTerminalClipboard(text)
					.then(() => {
						setCopied(true);
						if (copiedTimer.current) clearTimeout(copiedTimer.current);
						copiedTimer.current = setTimeout(() => setCopied(false), 1000);
					})
					.catch(() => {});
		});
		terminalContextMenuLinkStore.setActions(instanceId, linkMenu);
		registry.setLinkHandlers(
			terminalId,
			{
				stat: async (path) =>
					current.current.client?.filesystem.statPath.mutate({
						workspaceId,
						path,
					}) ?? null,
				onLinkHover: (event, link) => {
					keepHover();
					hovered.current = link;
					setLinkHover({ link, x: event.clientX, y: event.clientY });
				},
				onLinkLeave: () => {
					hovered.current = null;
					leaveHover();
				},
				onFileLinkClick: (event, link) => {
					const target: LinkHoverInfo = { ...link, kind: "file" };
					const action = resolveTerminalLinkAction(
						target,
						current.current.linkSettings,
						event,
						current.current.remote,
					);
					if (action === null) return;
					event.preventDefault();
					closeHover();
					runLinkAction(target, action);
				},
				onUrlClick: (event, url) => {
					const target: LinkHoverInfo = { kind: "url", url };
					const action = resolveTerminalLinkAction(
						target,
						current.current.linkSettings,
						event,
						current.current.remote,
					);
					if (action === null) return;
					event.preventDefault();
					closeHover();
					runLinkAction(target, action);
				},
			},
			instanceId,
		);
		const uploadAndPaste = (files: File[]) => {
			void (async () => {
				try {
					if (!current.current.client) return;
					const paths = await uploadTerminalAttachments(
						current.current.client,
						workspaceId,
						files,
					);
					if (
						alive.current &&
						registry.getConnectionState(terminalId, instanceId) === "open"
					)
						registry.paste(terminalId, shellEscapePaths(paths), instanceId);
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: t({
									message: "Failed to send the files to the remote workspace",
								}),
					);
				}
			})();
		};
		registry.setImagePasteOverride(
			terminalId,
			remote ? uploadAndPaste : null,
			instanceId,
		);
		const url = new URL(`/terminal/${encodeURIComponent(terminalId)}`, baseUrl);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		url.searchParams.set("workspaceId", workspaceId);
		url.searchParams.set("token", connection.secret);
		registry.connect(terminalId, url.toString(), instanceId);
		changed();
		return () => {
			closeHover();
			hovered.current = null;
			alive.current = false;
			disposeState();
			disposeLogs();
			selection?.dispose();
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
			registry.setImagePasteOverride(terminalId, null, instanceId);
			terminalContextMenuLinkStore.clear(instanceId);
			current.current.onConnectionChange?.(false);
			registry.detach(terminalId, instanceId);
		};
	}, [
		baseUrl,
		connection.secret,
		workspaceId,
		terminalId,
		instanceId,
		remote,
		visible,
		t,
		closeHover,
		keepHover,
		leaveHover,
		linkMenu,
		runLinkAction,
	]);
	const terminal = registry.getTerminal(terminalId, instanceId);
	const state = registry.getConnectionState(terminalId, instanceId);
	const ended = registry.isSessionEnded(terminalId, instanceId);
	const diagnosis = registry.getConnectionDiagnosis(terminalId, instanceId);
	const onDrop = async (event: React.DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
		setDropping(false);
		if (state !== "open" || !terminal) return;
		try {
			const files = Array.from(event.dataTransfer.files);
			let paths: string[];
			if (files.length && remote) {
				const entries = Array.from(event.dataTransfer.items).filter(
					(item) => item.kind === "file",
				);
				if (entries.some((item) => item.webkitGetAsEntry?.()?.isDirectory))
					throw new Error(
						t({ message: "Folders cannot be sent to the remote workspace" }),
					);
				if (!client) return;
				paths = await uploadTerminalAttachments(client, workspaceId, files);
			} else if (files.length)
				paths = files
					.map((file) => window.webUtils.getPathForFile(file))
					.filter(Boolean);
			else {
				const text = event.dataTransfer.getData("text/plain");
				paths = text ? [text] : [];
			}
			if (
				paths.length &&
				alive.current &&
				registry.getConnectionState(terminalId, instanceId) === "open"
			) {
				registry.paste(terminalId, shellEscapePaths(paths), instanceId);
				terminal.focus();
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	};
	void revision;
	return (
		<div
			className="jedv-terminal"
			role="application"
			aria-label={t({ message: "Terminal" })}
			onWheelCapture={(event) => {
				if (container.current?.contains(event.target as Node)) closeHover();
			}}
			onContextMenuCapture={() => {
				terminalContextMenuLinkStore.record(instanceId, hovered.current);
				closeHover();
			}}
			onDragOver={(event) => {
				if (
					event.dataTransfer.types.includes("Files") ||
					event.dataTransfer.types.includes("text/plain")
				) {
					event.preventDefault();
					event.dataTransfer.dropEffect = "copy";
					setDropping(true);
				}
			}}
			onDragLeave={() => setDropping(false)}
			onDrop={(event) => void onDrop(event)}
		>
			{visible && linkHover && (
				<TerminalLinkHover
					link={linkHover.link}
					x={linkHover.x}
					y={linkHover.y}
					settings={linkSettings}
					handlers={linkHandlers}
					items={linkMenu(linkHover.link)}
					onAction={(action) => runLinkAction(linkHover.link, action)}
					onCopy={() => {
						const text =
							linkHover.link.kind === "url"
								? linkHover.link.url
								: linkHover.link.resolvedPath;
						if (text)
							void writeTerminalClipboard(text).catch((error) =>
								toast.error(String(error)),
							);
					}}
					onEnter={keepHover}
					onLeave={leaveHover}
				/>
			)}
			<TerminalNarrowedBanner
				terminalId={terminalId}
				terminalInstanceId={instanceId}
			/>
			<div className="relative min-h-0 flex-1">
				<TerminalSearch
					searchAddon={registry.getSearchAddon(terminalId, instanceId)}
					isOpen={searchOpen}
					onClose={() => {
						onSearchClose?.();
						terminal?.focus();
					}}
				/>
				<div ref={container} className="jedv-terminal-canvas h-full" />
				<ScrollToBottomButton terminal={terminal} />
				{copied && (
					<output className="pointer-events-none absolute bottom-3 right-3 rounded-full border border-border bg-background px-2 py-1 text-xs">
						<Trans>Copied</Trans>
					</output>
				)}
			</div>
			{dropping && (
				<div className="pointer-events-none absolute inset-0 z-10 rounded border-2 border-primary bg-primary/5" />
			)}
			{ended ? (
				<div className="flex shrink-0 items-center gap-2 border-t border-border px-2 py-1 text-xs text-muted-foreground">
					<span className="min-w-0 flex-1">
						{registry.endedCleanly(terminalId, instanceId)
							? t({ message: "Session ended" })
							: (diagnosis?.message ??
								t({ message: "The terminal session ended unexpectedly" }))}
					</span>
					<Button
						size="sm"
						variant="ghost"
						disabled={pending || !onNewShell}
						onClick={() => {
							setPending(true);
							void onNewShell?.()
								.catch((error) => toast.error(String(error)))
								.finally(() => setPending(false));
						}}
					>
						<Trans>New shell</Trans>
					</Button>
				</div>
			) : (
				state !== "open" && (
					<ConnectionPill
						label={
							state === "connecting"
								? t({ message: "Connecting…" })
								: t({ message: "Disconnected" })
						}
						detail={diagnosis?.message ?? t({ message: "Disconnected" })}
						dialing={state === "connecting"}
						onRetry={() => registry.retryConnect(terminalId, instanceId)}
					/>
				)
			)}
		</div>
	);
}
