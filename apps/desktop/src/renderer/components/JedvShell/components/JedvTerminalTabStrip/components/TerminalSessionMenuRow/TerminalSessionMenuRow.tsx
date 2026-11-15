import { useFormat } from "@jedv/i18n/react";
import { agentStatusFromEvent } from "@jedv/shared/agent-status";
import { DropdownMenuItem } from "@jedv/ui/dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { Bot, Check, Pencil, Trash2 } from "lucide-react";
import type { TerminalSession } from "../../../../types";
import type { SessionBinding } from "../../types";
export function TerminalSessionMenuRow({
	session,
	title,
	current,
	attached,
	binding,
	disabled,
	canContinue,
	onSelect,
	onRename,
	onKill,
	onContinue,
	killable = true,
}: {
	session: TerminalSession;
	title: string;
	current: boolean;
	attached: boolean;
	binding?: SessionBinding;
	disabled: boolean;
	canContinue: boolean;
	onSelect(): void;
	onRename?: () => void;
	onKill(): void;
	onContinue(): void;
	killable?: boolean;
}) {
	const { t } = useLingui();
	const { formatCompactRelativeTime, formatDateTime } = useFormat();
	const agentState =
		binding?.endedAt == null
			? agentStatusFromEvent(binding?.lastEventType ?? "")
			: null;
	const status = session.exited
		? t({ message: `Exited (${session.exitCode})` })
		: agentState === "working"
			? t({ message: "Run" })
			: agentState === "permission"
				? t({ message: "Approval needed" })
				: agentState === "failed"
					? t({ message: "Agent failed" })
					: agentState === "review"
						? t({ message: "Agent finished" })
						: t({ message: "Live terminal" });
	const time = Number.isFinite(session.createdAt) && session.createdAt > 0;
	const buttonClass =
		"shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-30";
	return (
		<DropdownMenuItem
			disabled={disabled}
			className="group flex min-w-0 items-center gap-2 py-2"
			onSelect={onSelect}
		>
			<span className="w-4 shrink-0">
				{current && <Check className="size-3.5" />}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-xs" title={title}>
					{title}
				</span>
				<span className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
					<span>
						{current
							? t({ message: "Current" })
							: attached
								? t({ message: "Attached" })
								: t({ message: "Detached" })}
					</span>
					<span
						title={
							agentState === "working"
								? t({ message: "The agent reports it is working." })
								: undefined
						}
					>
						{status}
					</span>
					<span title={time ? formatDateTime(session.createdAt) : undefined}>
						{time
							? formatCompactRelativeTime(session.createdAt)
							: t({ message: "Time unavailable" })}
					</span>
				</span>
			</span>
			{canContinue && (
				<button
					type="button"
					disabled={disabled}
					className={buttonClass}
					aria-label={t({ message: `Continue ${title}` })}
					title={t({ message: "Continue the same agent session" })}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onContinue();
					}}
				>
					<Bot className="size-3" />
				</button>
			)}
			{onRename && (
				<button
					type="button"
					disabled={disabled}
					className={buttonClass}
					aria-label={t({ message: `Rename ${title}` })}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onRename();
					}}
				>
					<Pencil className="size-3" />
				</button>
			)}
			{killable && (
				<button
					type="button"
					disabled={disabled}
					className={`${buttonClass} hover:bg-destructive/10 hover:text-destructive`}
					aria-label={t({ message: `Kill ${title}` })}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						onKill();
					}}
				>
					<Trash2 className="size-3" />
				</button>
			)}
		</DropdownMenuItem>
	);
}
