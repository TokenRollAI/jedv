import { errorMessage } from "@jedv/i18n/errors";
import { formatNumber } from "@jedv/i18n/format";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@jedv/ui/alert-dialog";
import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { LocalClient } from "../../local-client";
import type { Workspace } from "../../types";

export interface JedvResourceSummaryProps {
	client?: LocalClient;
	remote?: boolean;
	workspaces?: Workspace[];
	open?: boolean;
	onOpenChange?(open: boolean): void;
	showSummary?: boolean;
	onOpenWorkspace?(
		workspaceId: string,
		terminalId?: string | null,
	): Promise<void>;
}

export function JedvResourceSummary({
	client,
	remote = false,
	workspaces = [],
	open: controlledOpen,
	onOpenChange,
	showSummary = true,
	onOpenWorkspace,
}: JedvResourceSummaryProps = {}) {
	const { t } = useLingui();
	const [localOpen, setLocalOpen] = useState(false);
	const open = controlledOpen ?? localOpen;
	const setOpen = (value: boolean) => {
		setLocalOpen(value);
		onOpenChange?.(value);
	};
	const [killing, setKilling] = useState<{
		workspaceId: string;
		sessionId: string;
		title: string;
	} | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const metrics = electronTrpc.resourceMetrics.getSnapshot.useQuery(
		{ mode: open ? "interactive" : "idle", surface: "v2" },
		{ refetchInterval: open ? 3_000 : 5_000, enabled: showSummary || open },
	);
	const cpu = (value: number) =>
		`${formatNumber(value, { maximumFractionDigits: 1 })}%`;
	const memory = (value: number) =>
		`${formatNumber(value / (1024 * 1024), { maximumFractionDigits: 0 })} MB`;
	const kill = async () => {
		if (!client || remote || !killing || pending) return;
		setPending(true);
		setError(null);
		try {
			await client.terminal.killSession.mutate({
				workspaceId: killing.workspaceId,
				terminalId: killing.sessionId,
			});
			setKilling(null);
			await metrics.refetch();
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setPending(false);
		}
	};
	return (
		<>
			{showSummary && (
				<button
					type="button"
					onClick={() => setOpen(true)}
					aria-label={t({ message: "Check resources" })}
					className="flex h-6 w-full shrink-0 items-center gap-3 border-t border-border px-3 text-left text-[10px] text-muted-foreground hover:bg-accent"
				>
					<Trans>Desktop resources</Trans>
					{metrics.data ? (
						<>
							<span>CPU {cpu(metrics.data.totalCpu)}</span>
							<span>{memory(metrics.data.totalMemory)}</span>
						</>
					) : (
						<span>{metrics.error ? <Trans>Unavailable</Trans> : "…"}</span>
					)}
				</button>
			)}
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[80vh] max-w-2xl overflow-auto">
					<DialogHeader>
						<DialogTitle>
							<Trans>Desktop resources</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>
								Local desktop and terminal process usage. Closing a view keeps
								its process running; terminating a session stops its processes.
							</Trans>
						</DialogDescription>
					</DialogHeader>
					{remote && (
						<p className="text-xs text-muted-foreground">
							<Trans>
								These metrics belong to this device. Remote host processes are
								not included.
							</Trans>
						</p>
					)}
					{metrics.error && (
						<p role="alert" className="text-xs text-destructive">
							{errorMessage(metrics.error)}
						</p>
					)}
					<Button
						size="sm"
						variant="outline"
						disabled={metrics.isFetching}
						onClick={() => void metrics.refetch()}
					>
						<Trans>Refresh</Trans>
					</Button>
					{metrics.data && (
						<div className="space-y-4 text-xs">
							<div className="flex justify-between border-b border-border pb-2">
								<span>Jedv</span>
								<span>
									{cpu(metrics.data.app.cpu)} ·{" "}
									{memory(metrics.data.app.memory)}
								</span>
							</div>
							{metrics.data.workspaces.map((workspace) => (
								<section key={workspace.workspaceId} className="space-y-2">
									<div className="flex flex-wrap justify-between gap-2 font-medium">
										<span>
											{workspaces.find(
												(item) => item.id === workspace.workspaceId,
											)?.name ?? workspace.workspaceId}
										</span>
										<span>
											{cpu(workspace.cpu)} · {memory(workspace.memory)}
										</span>
									</div>
									{workspace.sessions.map((session) => (
										<div
											key={session.sessionId}
											className="flex flex-wrap items-center gap-2 rounded border border-border p-2"
										>
											<div className="min-w-0 flex-1">
												<p className="truncate">
													{session.title || session.sessionId}
												</p>
												<p className="text-muted-foreground">
													PID {session.pid} · {cpu(session.cpu)} ·{" "}
													{memory(session.memory)}
												</p>
											</div>
											{onOpenWorkspace && !remote && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														void onOpenWorkspace(
															workspace.workspaceId,
															session.sessionId,
														)
															.then(() => setOpen(false))
															.catch((cause) => setError(errorMessage(cause)));
													}}
												>
													<Trans>Open terminal</Trans>
												</Button>
											)}
											{client && !remote && (
												<Button
													variant="ghost"
													size="sm"
													disabled={pending}
													onClick={() => {
														setError(null);
														setKilling({
															workspaceId: workspace.workspaceId,
															sessionId: session.sessionId,
															title: session.title || session.sessionId,
														});
													}}
												>
													<Trans>Terminate</Trans>
												</Button>
											)}
										</div>
									))}
								</section>
							))}
							{metrics.data.workspaces.length === 0 && (
								<p className="text-muted-foreground">
									<Trans>
										No local terminal process metrics are available.
									</Trans>
								</p>
							)}
						</div>
					)}
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
				</DialogContent>
			</Dialog>
			<AlertDialog
				open={!!killing}
				onOpenChange={(value) => {
					if (!value && !pending) setKilling(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Terminate this terminal session?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>
								This stops {killing?.title} and its child processes. Unsaved
								work in the terminal can be lost.
							</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending}>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={pending}
							onClick={(event) => {
								event.preventDefault();
								void kill();
							}}
						>
							<Trans>Terminate session</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
