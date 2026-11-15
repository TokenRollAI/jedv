import { Badge } from "@jedv/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { LuRefreshCw, LuRotateCw } from "react-icons/lu";
import type { JedvParityViewContext } from "../../../../../../parity-types";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../../../JedvConfirmDialog/JedvConfirmDialog";
import { JedvIconButton } from "../../../../../JedvIconButton";
import { JedvSelect } from "../../../../../JedvSelect";
import { connectionFeatureKey } from "../../hooks/useConnectionFeature";
export function PeerOutbox({
	context,
	onClose,
}: {
	context: JedvParityViewContext;
	onClose(): void;
}) {
	const { t } = useLingui();
	const cache = useQueryClient(),
		key = connectionFeatureKey(context.hostUrl, "peers");
	const [filter, setFilter] = useState("dead"),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false),
		[blocked, setBlocked] = useState<Set<string>>(new Set()),
		[confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const busy = useRef(false);
	const status =
		filter === "pending" ||
		filter === "inflight" ||
		filter === "acked" ||
		filter === "dead"
			? filter
			: undefined;
	const query = useQuery({
		queryKey: [...key, "outbox", filter],
		queryFn: () => context.client.peers.outbox.query({ status, limit: 100 }),
		retry: false,
		gcTime: 30_000,
		refetchInterval: 10_000,
	});
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						<Trans>Mail outbox</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Delivered means the remote host stored the mail, not that a
							recipient read or acknowledged it.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="flex items-center gap-2">
					<JedvSelect
						label={t({ message: "Status" })}
						value={filter}
						disabled={pending}
						onValueChange={setFilter}
						options={[
							{ value: "all", label: t({ message: "All" }) },
							{ value: "dead", label: t({ message: "Needs retry" }) },
							{ value: "pending", label: t({ message: "Pending" }) },
							{ value: "inflight", label: t({ message: "Processing" }) },
							{ value: "acked", label: t({ message: "Delivered" }) },
						]}
					/>
					<JedvIconButton
						label={t({ message: "Refresh" })}
						disabled={pending}
						onClick={() =>
							void query
								.refetch({ throwOnError: true })
								.then(() => setBlocked(new Set()))
								.catch(() => setError(true))
						}
					>
						<LuRefreshCw className="size-3.5" />
					</JedvIconButton>
				</div>
				<div className="max-h-80 space-y-2 overflow-y-auto">
					{query.data?.map((row) => (
						<div
							key={row.id}
							className="flex min-w-0 items-center gap-2 rounded-md border border-border p-2"
						>
							<div className="min-w-0 flex-1">
								<p
									className="truncate text-xs"
									title={`${row.targetPeerId} / ${row.remoteTeamId} / ${row.remoteTo}`}
								>
									{row.targetPeerId} / {row.remoteTo}
								</p>
								<p
									className="truncate font-mono text-[10px] text-muted-foreground"
									title={row.id}
								>
									#{row.id.slice(0, 8)} · {row.attemptCount}
								</p>
								{row.lastError && (
									<p className="line-clamp-2 break-words text-[11px] text-destructive">
										{row.lastError}
									</p>
								)}
							</div>
							<Badge variant="secondary" className="shrink-0 text-[10px]">
								{row.status === "dead"
									? t({ message: "Needs retry" })
									: row.status === "acked"
										? t({ message: "Delivered" })
										: row.status === "inflight"
											? t({ message: "Processing" })
											: t({ message: "Pending" })}
							</Badge>
							{row.status === "dead" && (
								<JedvIconButton
									label={t({ message: "Retry" })}
									disabled={pending || query.isError || blocked.has(row.id)}
									onClick={() =>
										setConfirmation({
											title: t({ message: "Retry mail delivery?" }),
											description: t({
												message:
													"Delivered means the remote host stored the mail, not that a recipient read or acknowledged it.",
											}),
											detail: `${row.targetPeerId} / ${row.remoteTeamId} / ${row.remoteTo}\n${row.id}`,
											execute: async () => {
												if (busy.current) return;
												busy.current = true;
												setPending(true);
												setError(false);
												try {
													await context.client.peers.retryDeadOutbox.mutate({
														outboxId: row.id,
													});
													await cache.invalidateQueries({ queryKey: key });
												} catch {
													setBlocked(
														(previous) =>
															new Set([...previous, row.id].slice(-100)),
													);
													setError(true);
													throw new Error(t({ message: "Operation failed" }));
												} finally {
													busy.current = false;
													setPending(false);
												}
											},
										})
									}
								>
									<LuRotateCw className="size-3.5" />
								</JedvIconButton>
							)}
						</div>
					))}
					{query.isSuccess && !query.data.length && (
						<p className="py-4 text-xs text-muted-foreground">
							<Trans>No mail</Trans>
						</p>
					)}
				</div>
				{(query.isError || error) && (
					<p role="alert" className="text-xs text-destructive">
						<Trans>Operation failed</Trans>
					</p>
				)}
				{query.isPending && (
					<output className="text-xs">
						<Trans>Loading…</Trans>
					</output>
				)}
				{confirmation && (
					<JedvConfirmDialog
						confirmation={confirmation}
						onClose={() => setConfirmation(null)}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
