import { agentStatusFromEvent } from "@jedv/shared/agent-status";
import { Input } from "@jedv/ui/input";
import { useLingui } from "@lingui/react/macro";
import { type ReactNode, useRef, useState } from "react";
import {
	LuBell,
	LuCheck,
	LuCircleAlert,
	LuCopy,
	LuFolderGit2,
	LuFolderInput,
	LuFolderOpen,
	LuGitBranch,
	LuGitPullRequest,
	LuLoaderCircle,
	LuMonitor,
	LuPencil,
	LuPin,
	LuPinOff,
	LuRotateCcw,
	LuTerminal,
	LuTrash2,
	LuUnlink,
	LuX,
} from "react-icons/lu";
import { WorkspaceNameMarquee } from "renderer/components/WorkspaceNameMarquee";
import { useHotkeyDisplay } from "renderer/hotkeys";
import type { HotkeyId } from "renderer/hotkeys/registry";
import {
	AGENT_LABELS,
	NATIVE_PROVIDERS,
	type NativeProvider,
	type Workspace,
} from "../../types";
import type { ProjectActionContext } from "../JedvProjectActions";
import { JedvRowMenu, type RowAction } from "../JedvRowMenu";
export interface JedvWorkspaceRowProps {
	workspace: Workspace;
	active: boolean;
	agentStatus?: string;
	unread?: boolean;
	pinned?: boolean;
	ports?: number[];
	badges?: ReactNode;
	statusActions?: ReactNode;
	agentChips?: ReactNode;
	shortcutIndex?: number;
	context?: ProjectActionContext;
	groups?: { tag: string; name: string }[];
	onChanged?(context: ProjectActionContext): Promise<void>;
	onSelect(): void;
	onNewTerminal(): void;
	onLaunch(provider: NativeProvider): void;
	onRename(name: string): void | Promise<void>;
	onCopy(value: string): void;
	onFinder?: () => void;
	onDelete(): void;
	onOpenEditor?: () => void;
	onTogglePin?: () => void;
	onMarkRead?: () => void;
	onMarkUnread?: () => void;
	onClosePorts?: () => void;
	onCloseListeningPorts?: () => void;
	hasPullRequest?: boolean;
	disabled?: boolean;
}
export function JedvWorkspaceRow({
	workspace,
	active,
	agentStatus,
	unread,
	pinned,
	ports,
	badges,
	statusActions,
	agentChips,
	shortcutIndex = -1,
	context,
	groups,
	onChanged,
	onSelect,
	onNewTerminal,
	onLaunch,
	onRename,
	onCopy,
	onFinder,
	onDelete,
	onOpenEditor,
	onTogglePin,
	onMarkRead,
	onMarkUnread,
	onClosePorts,
	onCloseListeningPorts,
	hasPullRequest,
	disabled = false,
}: JedvWorkspaceRowProps) {
	const { t } = useLingui();
	const shortcut = useHotkeyDisplay(
		`JUMP_TO_WORKSPACE_${Math.max(1, Math.min(shortcutIndex + 1, 9))}` as HotkeyId,
	).text;
	const closeShortcut = useHotkeyDisplay("CLOSE_WORKSPACE").text;
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(workspace.name || workspace.branch);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const busy = useRef(false);
	const cancelled = useRef(false);
	const button = useRef<HTMLButtonElement>(null);
	const startRename = () => {
		cancelled.current = false;
		setName(workspace.name || workspace.branch);
		setEditing(true);
		setError(null);
	};
	const run = async (work: () => Promise<void>) => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			await work();
		} catch {
			setError(t({ message: "Could not update workspace. Try again." }));
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	const rename = () =>
		void run(async () => {
			if (name.trim() && name.trim() !== (workspace.name || workspace.branch))
				await onRename(name.trim());
			setEditing(false);
			button.current?.focus();
		});
	const changeTags = (tag: string | null) => {
		if (!context) return;
		const target = { ...context };
		void run(async () => {
			await target.client.workspace.update.mutate({
				id: workspace.id,
				tags: tag ? [tag] : [],
			});
			await onChanged?.(target);
		});
	};
	const unavailable = disabled || pending;
	const actions: RowAction[] = [
		{
			label: t({ message: "New Terminal" }),
			icon: <LuTerminal className="size-4" />,
			run: onNewTerminal,
			disabled: unavailable,
		},
		{
			label: t({ message: "Launch Agent" }),
			icon: <LuTerminal className="size-4" />,
			disabled: unavailable,
			children: NATIVE_PROVIDERS.map((provider) => ({
				label: AGENT_LABELS[provider],
				run: () => onLaunch(provider),
			})),
		},
		...(onTogglePin
			? [
					{
						label: pinned
							? t({ message: "Unpin workspace" })
							: t({ message: "Pin workspace" }),
						icon: pinned ? (
							<LuPinOff className="size-4" />
						) : (
							<LuPin className="size-4" />
						),
						run: onTogglePin,
						disabled: unavailable,
						separator: true,
					},
				]
			: []),
		{
			label: t({ message: "Rename" }),
			icon: <LuPencil className="size-4" />,
			run: startRename,
			disabled: unavailable,
			separator: true,
		},
		...(onFinder
			? [
					{
						label: t({ message: "Open in Finder" }),
						icon: <LuFolderOpen className="size-4" />,
						run: onFinder,
						disabled: unavailable,
					},
				]
			: []),
		...(onOpenEditor
			? [
					{
						label: t({ message: "Open in external editor" }),
						icon: <LuMonitor className="size-4" />,
						run: onOpenEditor,
						disabled: unavailable,
					},
				]
			: []),
		{
			label: t({ message: "Copy Branch Name" }),
			icon: <LuGitBranch className="size-4" />,
			run: () => onCopy(workspace.branch),
			disabled: unavailable,
			separator: true,
		},
		...(workspace.worktreePath
			? [
					{
						label: t({ message: "Copy Path" }),
						icon: <LuCopy className="size-4" />,
						run: () => onCopy(workspace.worktreePath ?? ""),
						disabled: unavailable,
					},
				]
			: []),
		{
			label: t({ message: "Copy Workspace ID" }),
			icon: <LuCopy className="size-4" />,
			run: () => onCopy(workspace.id),
			disabled: unavailable,
		},
		...(onMarkRead
			? [
					{
						label: t({ message: "Mark as read" }),
						icon: <LuCheck className="size-4" />,
						run: onMarkRead,
						disabled: unavailable,
						separator: true,
					},
				]
			: []),
		...(onMarkUnread
			? [
					{
						label: t({ message: "Mark as unread" }),
						icon: <LuBell className="size-4" />,
						run: onMarkUnread,
						disabled: unavailable,
						separator: true,
					},
				]
			: []),
		...(context
			? [
					{
						label: t({ message: "Clear Status" }),
						icon: <LuRotateCcw className="size-4" />,
						disabled: unavailable,
						run: () => {
							const target = { ...context };
							void run(async () => {
								await target.client.terminalAgents.clearWorkspaceStatuses.mutate(
									{ workspaceId: workspace.id },
								);
								await onChanged?.(target);
							});
						},
					},
				]
			: []),
		...(context && groups
			? [
					{
						label: t({ message: "Move to group" }),
						icon: <LuFolderInput className="size-4" />,
						disabled: unavailable,
						children: [
							{
								label: t({ message: "Ungrouped" }),
								run: () => changeTags(null),
							},
							...groups.map((group) => ({
								label: group.name,
								run: () => changeTags(group.tag),
							})),
						],
					},
				]
			: []),
		...(context && hasPullRequest
			? [
					{
						label: t({ message: "Remove pull request link" }),
						icon: <LuUnlink className="size-4" />,
						disabled: unavailable,
						run: () => {
							const target = { ...context };
							void run(async () => {
								await target.client.pullRequests.unlinkFromWorkspace.mutate({
									workspaceId: workspace.id,
								});
								await onChanged?.(target);
							});
						},
					},
				]
			: []),
		...(onClosePorts && ports?.length
			? [
					{
						label: t({ message: "Close forwarded ports" }),
						icon: <LuMonitor className="size-4" />,
						run: onClosePorts,
						disabled: unavailable,
					},
				]
			: []),
		...(onCloseListeningPorts && ports?.length
			? [
					{
						label: t({ message: "Stop listening processes…" }),
						icon: <LuCircleAlert className="size-4" />,
						run: onCloseListeningPorts,
						destructive: true,
						disabled: unavailable,
					},
				]
			: []),
		{
			label: t({ message: "Delete Workspace…" }),
			icon: <LuTrash2 className="size-4" />,
			run: onDelete,
			destructive: true,
			disabled: unavailable,
			separator: true,
		},
	];
	const status = agentStatusFromEvent(agentStatus ?? "");
	const statusLabel =
		status === "permission"
			? t({ message: "Waiting for approval" })
			: status === "failed"
				? t({ message: "Agent failed" })
				: status === "working"
					? t({ message: "Working" })
					: status === "review"
						? t({ message: "Finished" })
						: t({ message: "Idle" });
	const Icon =
		status === "permission"
			? LuBell
			: status === "failed"
				? LuCircleAlert
				: status === "working"
					? LuLoaderCircle
					: status === "review"
						? LuCheck
						: workspace.type === "local"
							? LuFolderGit2
							: LuGitBranch;
	return (
		<div>
			<JedvRowMenu
				className={`mx-2 h-7 rounded-md ${active ? "bg-fill-selected text-foreground" : "text-foreground/80 hover:bg-fill-hover hover:text-foreground"}`}
				actions={actions}
			>
				<button
					ref={button}
					type="button"
					disabled={unavailable}
					aria-current={active ? "page" : undefined}
					className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-6 pr-24 text-left focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
					onClick={onSelect}
					onDoubleClick={startRename}
				>
					<Icon
						title={statusLabel}
						aria-label={statusLabel}
						className={`size-4 shrink-0 ${status === "permission" ? "text-warning" : status === "failed" ? "text-destructive" : status === "working" ? "animate-spin text-chart-1" : "text-muted-foreground"}`}
					/>
					<WorkspaceNameMarquee
						name={workspace.name || workspace.branch}
						className="text-[13px] leading-tight"
					/>
					{unread && (
						<span
							className="size-1.5 shrink-0 rounded-full bg-primary"
							role="img"
							aria-label={t({ message: "Unread activity" })}
						/>
					)}{" "}
					{pinned && (
						<LuPin className="size-3 shrink-0 text-muted-foreground" />
					)}
					{hasPullRequest && !statusActions && (
						<LuGitPullRequest className="size-3 shrink-0 text-muted-foreground" />
					)}
					{!!ports?.length && !statusActions && (
						<span
							className="text-[10px] text-muted-foreground"
							title={ports.join(", ")}
						>
							{ports.length}
						</span>
					)}
					{badges}
				</button>
				{!editing && (
					<div className="absolute right-14 flex items-center gap-1">
						{statusActions}
						{shortcutIndex >= 0 &&
							shortcutIndex < 9 &&
							shortcut !== "Unassigned" && (
								<span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
									{shortcut}
								</span>
							)}
					</div>
				)}
				{editing && (
					<Input
						data-inline-edit
						autoFocus
						disabled={pending}
						aria-label={t({ message: "Workspace name" })}
						aria-invalid={!!error}
						className="absolute left-12 right-14 h-6 w-auto text-xs"
						value={name}
						onFocus={(event) => event.target.select()}
						onChange={(event) => {
							setName(event.target.value);
							setError(null);
						}}
						onBlur={() => {
							if (!cancelled.current && !error && !busy.current) rename();
						}}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Escape" && !pending) {
								cancelled.current = true;
								setEditing(false);
								setError(null);
								button.current?.focus();
							}
							if (
								event.key === "Enter" &&
								!event.nativeEvent.isComposing &&
								event.nativeEvent.keyCode !== 229
							) {
								event.preventDefault();
								rename();
							}
						}}
					/>
				)}
				<button
					type="button"
					disabled={unavailable}
					aria-label={t({ message: "Delete Workspace…" })}
					title={closeShortcut === "Unassigned" ? undefined : closeShortcut}
					onClick={onDelete}
					className="absolute right-7 grid size-5 place-items-center rounded text-muted-foreground opacity-0 hover:bg-foreground/10 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-50"
				>
					<LuX className="size-3.5" />
				</button>
			</JedvRowMenu>
			{agentChips}
			{error && (
				<p role="alert" className="mx-4 py-1 text-xs text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
