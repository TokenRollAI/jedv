import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import type { LocalClient } from "../../local-client";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../JedvConfirmDialog/JedvConfirmDialog";
import { useDaemonStatus } from "./hooks/useDaemonStatus/useDaemonStatus";
export interface JedvDaemonStatusProps {
	client: LocalClient;
	hostUrl: string;
	active?: boolean;
}
export function JedvDaemonStatus(props: JedvDaemonStatusProps) {
	const { t } = useLingui(),
		daemon = useDaemonStatus(props);
	const [showSessions, setShowSessions] = useState(false);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [refreshError, setRefreshError] = useState<string | null>(null);
	const activeHost = useRef<string | null>(props.hostUrl);
	activeHost.current = props.hostUrl;
	useEffect(() => {
		activeHost.current = props.hostUrl;
		setConfirmation(null);
		setRefreshError(null);
		return () => {
			if (activeHost.current === props.hostUrl) activeHost.current = null;
		};
	}, [props.hostUrl]);
	const version = daemon.versions.data;
	const failure =
		daemon.action.error?.message ?? version?.autoUpdateFailure?.reason;
	return (
		<section
			className="space-y-2 rounded-lg border border-border p-4 text-xs"
			aria-label={t({ message: "Terminal daemon" })}
		>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h3 className="text-sm font-medium">
					<Trans>Terminal daemon</Trans>
				</h3>
				{version && (
					<span className="font-mono text-[11px] text-muted-foreground">
						{version.running} {version.pending ? `→ ${version.expected}` : ""}
					</span>
				)}
			</div>
			<p className="mt-0.5 text-sm text-muted-foreground">
				<Trans>Owns every PTY session and survives app restarts.</Trans>
			</p>
			<output className="block text-muted-foreground">
				{daemon.versions.isPending ? (
					<Trans>Loading…</Trans>
				) : !version || !daemon.health.data ? (
					<Trans>Daemon unavailable</Trans>
				) : daemon.health.data.reachable ? (
					<Trans>Reachable</Trans>
				) : (
					<Trans>Unreachable</Trans>
				)}
			</output>
			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span
					aria-hidden
					className={`size-1.5 rounded-full ${daemon.sessions.error || !daemon.health.data?.reachable ? "bg-destructive" : daemon.sessions.data?.length ? "bg-emerald-500" : "bg-muted-foreground/60"}`}
				/>
				<button
					type="button"
					disabled={!daemon.sessions.data?.length}
					aria-expanded={showSessions}
					onClick={() => setShowSessions((value) => !value)}
					className="rounded hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default"
				>
					{daemon.sessions.isPending ? (
						<Trans>Loading…</Trans>
					) : daemon.sessions.error ? (
						<Trans>Daemon unavailable</Trans>
					) : (
						<Trans>{daemon.sessions.data?.length ?? 0} sessions</Trans>
					)}
				</button>
				{version?.pending && (
					<span className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
						<Trans>Update available</Trans>
					</span>
				)}
			</div>
			{daemon.sessions.error && (
				<p role="alert" className="text-destructive">
					{daemon.sessions.error.message}
				</p>
			)}
			{showSessions && daemon.sessions.data && (
				<div className="max-h-64 overflow-auto">
					<table className="w-full text-xs">
						<thead className="sticky top-0 bg-background">
							<tr className="text-muted-foreground">
								<th className="px-2 py-2 text-left font-medium">
									<Trans>Session</Trans>
								</th>
								<th className="px-2 py-2 text-right font-medium">
									<Trans>PID</Trans>
								</th>
								<th className="px-2 py-2 text-right font-medium">
									<Trans>Size</Trans>
								</th>
								<th className="px-2 py-2 text-left font-medium">
									<Trans>Status</Trans>
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border/40">
							{daemon.sessions.data.map((session) => (
								<tr key={session.id} className="hover:bg-muted/30">
									<td className="px-2 py-2 font-mono">{session.id}</td>
									<td className="px-2 py-2 text-right font-mono">
										{session.pid || "—"}
									</td>
									<td className="px-2 py-2 text-right font-mono">
										{session.cols}×{session.rows}
									</td>
									<td className="px-2 py-2">
										{session.alive ? (
											<Trans>Alive</Trans>
										) : (
											<Trans>Exited</Trans>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{(daemon.versions.error || daemon.health.error || refreshError) && (
				<p role="alert" className="break-words text-destructive">
					{refreshError ??
						daemon.versions.error?.message ??
						daemon.health.error?.message}
				</p>
			)}
			{failure && (
				<div role="alert" className="space-y-1 text-destructive">
					<p>
						<Trans>Update did not finish. Review status before retrying.</Trans>
					</p>
					<p className="break-words font-mono text-[11px]">{failure}</p>
				</div>
			)}
			{daemon.notice && (
				<output className="block text-muted-foreground">{daemon.notice}</output>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={
						daemon.action.isPending ||
						!version ||
						!daemon.health.data?.reachable ||
						daemon.versions.isPending
					}
					onClick={() =>
						void daemon.action.mutateAsync("update").catch(() => {})
					}
				>
					{daemon.action.isPending && daemon.action.variables === "update" ? (
						<Trans>Updating…</Trans>
					) : (
						<Trans>Update daemon</Trans>
					)}
				</Button>
				<Button
					size="sm"
					variant="ghost"
					disabled={
						daemon.action.isPending || (!version && !daemon.health.data)
					}
					onClick={() =>
						setConfirmation({
							title: t({ message: "Force restart terminal daemon?" }),
							description: t({
								message:
									"This closes every terminal session on this host, including running agents and background processes. Restart does not preserve sessions.",
							}),
							detail: props.hostUrl,
							execute: async () => {
								if (activeHost.current !== props.hostUrl)
									throw new Error(
										t({
											message:
												"Host changed. Review the current daemon before restarting.",
										}),
									);
								await daemon.action.mutateAsync("restart");
							},
						})
					}
				>
					<Trans>Force restart</Trans>
				</Button>
				<Button
					size="sm"
					variant="ghost"
					disabled={
						daemon.action.isPending ||
						daemon.versions.isFetching ||
						daemon.health.isFetching
					}
					onClick={() => {
						setRefreshError(null);
						void daemon
							.refresh()
							.catch((error) =>
								setRefreshError(
									error instanceof Error ? error.message : String(error),
								),
							);
					}}
				>
					<Trans>Refresh</Trans>
				</Button>
			</div>
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</section>
	);
}
