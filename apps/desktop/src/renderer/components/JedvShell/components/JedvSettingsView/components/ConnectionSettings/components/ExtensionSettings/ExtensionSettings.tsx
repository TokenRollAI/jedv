import { Switch } from "@jedv/ui/switch";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
	LuKeyRound,
	LuLogOut,
	LuPlus,
	LuPuzzle,
	LuRefreshCw,
	LuTrash2,
} from "react-icons/lu";
import { teamworkKey } from "../../../../../../hooks/useTeamwork";
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
import { ProviderTokenEditor } from "../ProviderTokenEditor/ProviderTokenEditor";
import { SlotInstaller } from "../SlotInstaller/SlotInstaller";
export function ExtensionSettings(context: JedvParityViewContext) {
	const { t } = useLingui();
	const { client, hostUrl } = context;
	const cache = useQueryClient();
	const slots = useConnectionFeature(context, "declarativeSlots"),
		peers = useConnectionFeature(context, "peers");
	const slotKey = connectionFeatureKey(hostUrl, "declarativeSlots"),
		peerKey = connectionFeatureKey(hostUrl, "peers");
	const installed = useQuery({
		queryKey: [...slotKey, "list"],
		queryFn: () => client.declarativeSlots.list.query(),
		enabled: slots.supported,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 30_000,
	});
	const providers = useQuery({
		queryKey: [...peerKey, "providers"],
		queryFn: () => client.peers.listProviderTokens.query(),
		enabled: peers.supported,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 30_000,
	});
	const teams = useQuery({
		queryKey: [...teamworkKey(hostUrl), "list"],
		queryFn: () => client.team.list.query({ status: "all" }),
		enabled: slots.supported || peers.supported,
		retry: false,
		gcTime: 30_000,
	});
	const activeTeams =
		teams.data?.filter(
			(team) => team.status === "active" || team.status === "paused",
		) ?? [];
	const [installing, setInstalling] = useState(false),
		[creating, setCreating] = useState(false),
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
			await Promise.all([
				cache.invalidateQueries({ queryKey: slotKey }),
				cache.invalidateQueries({ queryKey: peerKey }),
			]);
		} catch {
			setError(true);
			throw new Error(t({ message: "Operation failed" }));
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	const slotUnavailable =
		pending || !slots.supported || !installed.isSuccess || installed.isError;
	return (
		<section
			className="space-y-3 rounded-lg border border-border p-4"
			aria-label={t({ message: "Declarative extensions" })}
		>
			<header className="flex items-center gap-2">
				<LuPuzzle className="size-4 text-muted-foreground" />
				<h3 className="flex-1 text-sm font-medium">
					<Trans>Declarative extensions</Trans>
				</h3>
				<JedvIconButton
					label={t({ message: "Refresh" })}
					disabled={pending}
					onClick={() => {
						void slots.query.refetch();
						void peers.query.refetch();
						void installed.refetch();
						void providers.refetch();
						void teams.refetch();
					}}
				>
					<LuRefreshCw className="size-3.5" />
				</JedvIconButton>
				<JedvIconButton
					label={t({ message: "Install extension" })}
					disabled={slotUnavailable}
					onClick={() => setInstalling(true)}
				>
					<LuPlus className="size-4" />
				</JedvIconButton>
			</header>
			{!slots.supported ? (
				<FeatureStatus
					loading={slots.query.isPending}
					retry={() => void slots.query.refetch()}
				/>
			) : (
				installed.data?.slice(0, 100).map((extension) => (
					<div
						key={extension.manifest.id}
						className="flex min-w-0 items-center gap-2"
					>
						<div className="min-w-0 flex-1">
							<p className="truncate text-xs" title={extension.manifest.id}>
								{extension.manifest.name}
							</p>
							<p className="truncate text-[11px] text-muted-foreground">
								{teams.data?.find((team) => team.id === extension.teamId)
									?.name ??
									(extension.teamId
										? `#${extension.teamId.slice(0, 8)}`
										: t({ message: "No team" }))}
							</p>
						</div>
						<Switch
							checked={extension.enabled}
							aria-label={extension.manifest.name}
							disabled={slotUnavailable}
							onCheckedChange={(enabled) =>
								void run(async () => {
									const result =
										await client.declarativeSlots.setEnabled.mutate({
											extensionId: extension.manifest.id,
											enabled,
										});
									if (result.providerToken)
										setSecret(result.providerToken.token);
								}).catch(() => {})
							}
						/>
						<JedvIconButton
							label={t({ message: "Uninstall extension" })}
							disabled={slotUnavailable}
							onClick={() =>
								setConfirmation({
									title: t({ message: "Uninstall extension" }),
									description: t({
										message: "Associated provider tokens will be revoked.",
									}),
									detail: extension.manifest.name,
									execute: () =>
										run(() =>
											client.declarativeSlots.uninstall.mutate({
												extensionId: extension.manifest.id,
											}),
										),
								})
							}
						>
							<LuTrash2 className="size-3.5" />
						</JedvIconButton>
					</div>
				))
			)}
			{peers.supported && (
				<div className="space-y-2 border-t border-border pt-3">
					<header className="flex items-center gap-2">
						<LuKeyRound className="size-3.5 text-muted-foreground" />
						<h4 className="flex-1 text-xs font-medium">
							<Trans>Provider tokens</Trans>
						</h4>
						<JedvIconButton
							label={t({ message: "Create provider token" })}
							disabled={
								pending ||
								!providers.isSuccess ||
								providers.isError ||
								teams.isError ||
								!activeTeams.length
							}
							onClick={() => setCreating(true)}
						>
							<LuPlus className="size-3.5" />
						</JedvIconButton>
					</header>
					{providers.data
						?.filter((token) => token.revokedAt == null)
						.slice(0, 100)
						.map((token) => (
							<div key={token.id} className="flex min-w-0 items-center gap-2">
								<div className="min-w-0 flex-1">
									<p className="truncate text-xs" title={token.id}>
										{token.name}
									</p>
									<p
										className="truncate font-mono text-[11px] text-muted-foreground"
										title={`${token.typePrefix} · ${token.allowedTo}`}
									>
										{token.tokenHint} · {token.typePrefix}
									</p>
								</div>
								<JedvIconButton
									label={t({ message: "Revoke token" })}
									disabled={pending || providers.isError}
									onClick={() =>
										setConfirmation({
											title: t({ message: "Revoke token" }),
											description: t({
												message: "Associated provider tokens will be revoked.",
											}),
											detail: token.name,
											execute: () =>
												run(() =>
													client.peers.revokeProviderToken.mutate({
														tokenId: token.id,
													}),
												),
										})
									}
								>
									<LuLogOut className="size-3.5" />
								</JedvIconButton>
							</div>
						))}
				</div>
			)}
			{(error || installed.isError || providers.isError || teams.isError) && (
				<p role="alert" className="text-xs text-destructive">
					<Trans>Operation failed</Trans>
				</p>
			)}
			{installing && (
				<SlotInstaller
					teams={activeTeams}
					onClose={() => setInstalling(false)}
					onSave={(input) =>
						run(async () => {
							const result =
								await client.declarativeSlots.install.mutate(input);
							if (result.providerToken) setSecret(result.providerToken.token);
						})
					}
				/>
			)}
			{creating && (
				<ProviderTokenEditor
					teams={activeTeams}
					onClose={() => setCreating(false)}
					onSave={(input) =>
						run(async () => {
							const result =
								await client.peers.createProviderToken.mutate(input);
							setSecret(result.token);
						})
					}
				/>
			)}
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
			{secret && (
				<OneTimeSecret
					title={t({ message: "Provider token" })}
					value={secret}
					onClose={() => setSecret(null)}
				/>
			)}
		</section>
	);
}
