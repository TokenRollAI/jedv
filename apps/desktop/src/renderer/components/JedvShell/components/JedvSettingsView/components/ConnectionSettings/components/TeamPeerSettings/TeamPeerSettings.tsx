import type { PeerSummary } from "@jedv/shared/teamwork-peers";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
	LuCopy,
	LuKeyRound,
	LuMailWarning,
	LuNetwork,
	LuPencil,
	LuPlus,
	LuRefreshCw,
	LuTrash2,
} from "react-icons/lu";
import type { JedvParityViewContext } from "../../../../../../parity-types";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../../../JedvConfirmDialog/JedvConfirmDialog";
import { JedvIconButton } from "../../../../../JedvIconButton";
import {
	connectionFeatureKey,
	useConnectionFeature,
} from "../../hooks/useConnectionFeature";
import { FeatureStatus } from "../FeatureStatus/FeatureStatus";
import { OneTimeSecret } from "../OneTimeSecret/OneTimeSecret";
import { PeerEditor } from "../PeerEditor/PeerEditor";
import { PeerOutbox } from "../PeerOutbox/PeerOutbox";
export function TeamPeerSettings(context: JedvParityViewContext) {
	const { t } = useLingui();
	const { client, hostUrl } = context;
	const cache = useQueryClient(),
		key = connectionFeatureKey(hostUrl, "peers");
	const feature = useConnectionFeature(context, "peers");
	const query = useQuery({
		queryKey: [...key, "list"],
		queryFn: () => client.peers.list.query(),
		enabled: feature.supported,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 30_000,
	});
	const dead = useQuery({
		queryKey: [...key, "dead-count"],
		queryFn: () => client.peers.outbox.query({ status: "dead", limit: 100 }),
		enabled: feature.supported,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 15_000,
	});
	const [editor, setEditor] = useState<PeerSummary | "new" | null>(null),
		[outbox, setOutbox] = useState(false),
		[secret, setSecret] = useState<string | null>(null),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false),
		[confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const busy = useRef(false);
	const run = async (work: () => Promise<unknown>) => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setError(false);
		try {
			await work();
			await cache.invalidateQueries({ queryKey: key });
		} catch {
			setError(true);
			throw new Error(t({ message: "Operation failed" }));
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	const unavailable =
		pending || !feature.supported || !query.isSuccess || query.isError;
	return (
		<section
			className="space-y-3 rounded-lg border border-border p-4"
			aria-label={t({ message: "Team peers" })}
		>
			<header className="flex items-center gap-2">
				<LuNetwork className="size-4 text-muted-foreground" />
				<h3 className="flex-1 text-sm font-medium">
					<Trans>Team peers</Trans>
				</h3>
				<JedvIconButton
					label={t({ message: "Refresh" })}
					disabled={pending}
					onClick={() => {
						void feature.query.refetch();
						void query.refetch();
						void dead.refetch();
					}}
				>
					<LuRefreshCw className="size-3.5" />
				</JedvIconButton>
				<JedvIconButton
					label={t({ message: "Add peer" })}
					disabled={unavailable}
					onClick={() => setEditor("new")}
				>
					<LuPlus className="size-4" />
				</JedvIconButton>
			</header>
			{!feature.supported ? (
				<FeatureStatus
					loading={feature.query.isPending}
					retry={() => void feature.query.refetch()}
				/>
			) : (
				<>
					{query.data?.localHostId && (
						<div className="flex min-w-0 items-center gap-1">
							<span className="shrink-0 text-[11px] text-muted-foreground">
								<Trans>This host</Trans>
							</span>
							<span
								className="min-w-0 flex-1 truncate font-mono text-[11px]"
								title={query.data.localHostId}
							>
								{query.data.localHostId}
							</span>
							<JedvIconButton
								label={t({ message: "Copy" })}
								onClick={() =>
									void navigator.clipboard
										.writeText(query.data?.localHostId ?? "")
										.catch(() => setError(true))
								}
							>
								<LuCopy className="size-3" />
							</JedvIconButton>
						</div>
					)}
					{query.data?.items.slice(0, 100).map((peer) => (
						<div key={peer.id} className="flex min-w-0 items-center gap-1">
							<span
								className={`size-1.5 shrink-0 rounded-full ${peer.enabled ? "bg-success" : "bg-muted-foreground"}`}
								title={
									peer.enabled
										? t({ message: "Enabled" })
										: t({ message: "Disabled" })
								}
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-xs" title={peer.id}>
									{peer.name}
								</p>
								<p
									className="truncate text-[11px] text-muted-foreground"
									title={peer.origin}
								>
									{peer.origin}
								</p>
							</div>
							<JedvIconButton
								label={t({ message: "Edit peer" })}
								disabled={unavailable}
								onClick={() => setEditor(peer)}
							>
								<LuPencil className="size-3.5" />
							</JedvIconButton>
							<JedvIconButton
								label={t({ message: "Rotate inbound token" })}
								disabled={unavailable}
								onClick={() =>
									setConfirmation({
										title: t({ message: "Rotate inbound token" }),
										description: t({
											message:
												"The previous token will stop working. Update the remote peer with the new token.",
										}),
										detail: peer.name,
										execute: () =>
											run(async () => {
												const result = await client.peers.rotateInbound.mutate({
													peerId: peer.id,
												});
												setSecret(result.inboundToken);
											}),
									})
								}
							>
								<LuKeyRound className="size-3.5" />
							</JedvIconButton>
							<JedvIconButton
								label={t({ message: "Remove peer" })}
								disabled={unavailable}
								onClick={() =>
									setConfirmation({
										title: t({ message: "Remove peer" }),
										description: t({
											message:
												"Mail-only access. The host administration key is never shared.",
										}),
										detail: `${peer.name}\n${peer.origin}`,
										execute: () =>
											run(() =>
												client.peers.remove.mutate({ peerId: peer.id }),
											),
									})
								}
							>
								<LuTrash2 className="size-3.5" />
							</JedvIconButton>
						</div>
					))}
					<p className="text-[11px] text-muted-foreground">
						<Trans>
							Mail-only access. The host administration key is never shared.
						</Trans>
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 gap-2 text-xs"
						disabled={unavailable}
						onClick={() => setOutbox(true)}
					>
						<LuMailWarning className="size-3.5" />
						<Trans>Mail outbox</Trans>
						{dead.data?.length
							? ` · ${dead.data.length}${dead.data.length >= 100 ? "+" : ""}`
							: ""}
					</Button>
					{(error || query.isError || dead.isError) && (
						<p role="alert" className="text-xs text-destructive">
							<Trans>Operation failed</Trans>
						</p>
					)}
				</>
			)}
			{editor && (
				<PeerEditor
					initial={editor === "new" ? undefined : editor}
					onClose={() => setEditor(null)}
					onSave={(input) =>
						run(async () => {
							const result = await client.peers.upsert.mutate(input);
							if (result.inboundToken) setSecret(result.inboundToken);
						})
					}
				/>
			)}
			{outbox && (
				<PeerOutbox context={context} onClose={() => setOutbox(false)} />
			)}
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
			{secret && (
				<OneTimeSecret
					title={t({ message: "Inbound mail token" })}
					value={secret}
					onClose={() => setSecret(null)}
				/>
			)}
		</section>
	);
}
