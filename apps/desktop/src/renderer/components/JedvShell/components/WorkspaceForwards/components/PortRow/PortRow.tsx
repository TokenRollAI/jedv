import { cn } from "@jedv/ui/utils";
import { useLingui } from "@lingui/react/macro";
import { LuCopy, LuExternalLink, LuLoaderCircle, LuX } from "react-icons/lu";
import type { PortForward } from "shared/types";
import type { WorkspacePortRowData } from "../../types";

const STROKE_WIDTH = 1.75;
interface PortRowProps {
	port: WorkspacePortRowData;
	forward?: PortForward;
	remote: boolean;
	pending: boolean;
	error?: string;
	onAction(
		action:
			| "open"
			| "external"
			| "copy"
			| "kill"
			| "forward"
			| "stop"
			| "retry"
			| "stop-local",
	): void;
}
/**
 * One port in the top-bar dropdown: a fixed mono port column, the label and
 * process, and a hover-revealed action cluster (open / copy / close).
 */
export function PortRow({
	port,
	forward,
	remote,
	pending: isPending,
	error,
	onAction,
}: PortRowProps) {
	const { t } = useLingui();
	const canOpenInBrowser = !remote || forward?.status.state === "active";
	const description = [port.label, port.processName]
		.filter(Boolean)
		.join(" · ");
	const address = {
		text: remote
			? forward?.status.state === "active"
				? `127.0.0.1:${forward.status.localPort}`
				: (forward?.status.state ?? t({ message: "Not forwarded" }))
			: `127.0.0.1:${port.port}`,
		title:
			forward?.status.state === "error" ? forward.status.message : undefined,
	};
	const handleOpen = () => onAction(canOpenInBrowser ? "open" : "forward");
	const handleOpenExternal = () => onAction("external");
	const handleCopy = () => onAction("copy");
	const handleClose = () => onAction("kill");
	return (
		<div
			className={cn(
				"group/port relative rounded-md transition-colors hover:bg-fill-hover",
				isPending && "opacity-60",
			)}
		>
			<button
				type="button"
				onClick={handleOpen}
				disabled={isPending}
				className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			>
				<span className="font-medium font-mono text-foreground text-xs tabular-nums">
					:{port.port}
				</span>
				<span
					className="truncate text-[11px] text-muted-foreground"
					title={address.title}
				>
					{description ? `${description} · ${address.text}` : address.text}
				</span>
			</button>
			{forward?.status.state === "busy" && (
				<div className="px-2 pb-1.5">
					{forward.status.localOwner && (
						<button
							type="button"
							disabled={isPending}
							className="mr-2 text-xs underline"
							onClick={() => onAction("stop-local")}
						>
							{t({ message: "Stop local process" })}
						</button>
					)}
					<button
						type="button"
						className="text-xs underline"
						onClick={() => onAction("retry")}
					>
						{t({ message: "Use another local port" })}
					</button>
				</div>
			)}
			{remote && (!forward || forward.explicit) && (
				<div className="flex px-2 pb-1.5">
					<button
						type="button"
						className="text-xs underline"
						disabled={isPending}
						onClick={() => onAction(forward ? "stop" : "forward")}
					>
						{forward
							? t({ message: "Stop forwarding" })
							: t({ message: "Forward" })}
					</button>
				</div>
			)}
			{error && (
				<p role="alert" className="px-2 pb-1 text-xs text-destructive">
					{error}
				</p>
			)}
			{forward?.status.state === "error" && (
				<p role="alert" className="px-2 pb-1 text-xs text-destructive">
					{forward.status.message}
					<button
						type="button"
						disabled={isPending}
						className="ml-2 underline"
						onClick={() => onAction("forward")}
					>
						{t({ message: "Retry" })}
					</button>
				</p>
			)}
			<div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-px rounded-md border border-border bg-popover/95 p-px opacity-0 transition-opacity focus-within:opacity-100 group-hover/port:opacity-100">
				{canOpenInBrowser && (
					<button
						type="button"
						aria-label={t({
							message: `Open localhost:${port.port} in external browser`,
						})}
						disabled={isPending}
						onClick={handleOpenExternal}
						className="rounded p-1 text-muted-foreground hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						<LuExternalLink className="size-3" strokeWidth={STROKE_WIDTH} />
					</button>
				)}
				{canOpenInBrowser && (
					<button
						type="button"
						aria-label={t({
							message: `Copy localhost:${port.port}`,
						})}
						onClick={() => void handleCopy()}
						className="rounded p-1 text-muted-foreground hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
					>
						<LuCopy className="size-3" strokeWidth={STROKE_WIDTH} />
					</button>
				)}
				<button
					type="button"
					aria-label={t({
						message: `Close port ${port.port}`,
					})}
					onClick={handleClose}
					disabled={isPending}
					className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				>
					{isPending ? (
						<LuLoaderCircle
							className="size-3 animate-spin"
							strokeWidth={STROKE_WIDTH}
						/>
					) : (
						<LuX className="size-3" strokeWidth={STROKE_WIDTH} />
					)}
				</button>
			</div>
		</div>
	);
}
