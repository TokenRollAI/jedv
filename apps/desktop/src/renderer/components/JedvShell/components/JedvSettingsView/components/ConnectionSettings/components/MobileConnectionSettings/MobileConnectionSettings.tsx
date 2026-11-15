import { formatRelativeTime } from "@jedv/i18n/format";
import { peerOriginSchema } from "@jedv/shared/teamwork-peers";
import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { toast } from "@jedv/ui/sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import {
	LuCheck,
	LuCopy,
	LuLogOut,
	LuPlus,
	LuRefreshCw,
	LuSmartphone,
	LuTrash2,
} from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
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
export function MobileConnectionSettings(context: JedvParityViewContext) {
	const { t } = useLingui();
	const { client, hostUrl } = context;
	const id = useId();
	const cache = useQueryClient();
	const feature = useConnectionFeature(context, "mobileAuth");
	const key = connectionFeatureKey(hostUrl, "mobileAuth");
	const origin = useQuery({
		queryKey: [...key, "origin"],
		queryFn: () => client.mobileAuth.getOrigin.query(),
		enabled: feature.supported,
		retry: false,
		gcTime: 30_000,
	});
	const sessions = useQuery({
		queryKey: [...key, "sessions"],
		queryFn: () => client.mobileAuth.listSessions.query(),
		enabled: feature.supported,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 15_000,
	});
	const tailscale =
		electronTrpc.hostServiceCoordinator.getTailscaleStatus.useQuery(undefined, {
			enabled: !context.remote,
		});
	const [draft, setDraft] = useState<string | null>(null),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false),
		[confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(
		null,
	);
	const busy = useRef(false);
	useEffect(() => {
		if (!code) return;
		const timer = setTimeout(
			() => setCode(null),
			Math.max(0, code.expiresAt - Date.now()),
		);
		return () => clearTimeout(timer);
	}, [code]);
	const text = draft ?? origin.data?.origin ?? "";
	const suggestion =
		!context.remote && tailscale.data?.dnsName
			? peerOriginSchema.safeParse(
					`https://${tailscale.data.dnsName.replace(/\.$/, "")}`,
				)
			: null;
	const valid = text.trim() ? peerOriginSchema.safeParse(text.trim()) : null;
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
	const save = (value: string | null) =>
		setConfirmation({
			title: t({ message: "Change mobile address?" }),
			description: t({
				message:
					"Changing or clearing this address signs out all paired devices.",
			}),
			detail: value ?? t({ message: "Disabled" }),
			execute: () =>
				run(async () => {
					await client.mobileAuth.setOrigin.mutate({ origin: value });
					setCode(null);
					setDraft(null);
				}),
		});
	const time = code ? formatRelativeTime(code.expiresAt) : "";
	const active = (sessions.data ?? [])
		.filter(
			(session) => session.revokedAt == null && session.expiresAt > Date.now(),
		)
		.slice(0, 100);
	return (
		<section
			className="space-y-3 rounded-lg border border-border p-4"
			aria-label={t({ message: "Mobile" })}
		>
			<header className="flex items-center gap-2">
				<LuSmartphone className="size-4 text-muted-foreground" />
				<h3 className="flex-1 text-sm font-medium">
					<Trans>Mobile</Trans>
				</h3>
				<JedvIconButton
					label={t({ message: "Refresh" })}
					disabled={pending}
					onClick={() => {
						void feature.query.refetch();
						void origin.refetch();
						void sessions.refetch();
					}}
				>
					<LuRefreshCw className="size-3.5" />
				</JedvIconButton>
				<JedvIconButton
					label={t({ message: "Pair device" })}
					disabled={
						pending ||
						!feature.supported ||
						!origin.data?.mobileUrl ||
						origin.isError
					}
					onClick={() =>
						void run(async () => {
							const issued = await client.mobileAuth.createPairingCode.mutate();
							setCode({ code: issued.code, expiresAt: issued.expiresAt });
						}).catch(() => {})
					}
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
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (valid?.success && valid.data !== origin.data?.origin)
								save(valid.data);
						}}
						className="space-y-2"
					>
						<label htmlFor={id} className="text-xs">
							<Trans>Mobile access address</Trans>
						</label>
						<div className="flex min-w-0 items-center gap-1">
							<Input
								id={id}
								type="url"
								value={text}
								maxLength={2048}
								disabled={pending || !origin.isSuccess || origin.isError}
								placeholder="https://my-host.tailnet.ts.net"
								onChange={(event) => setDraft(event.target.value)}
								className="min-w-0 flex-1 text-xs"
							/>
							<JedvIconButton
								label={t({ message: "Save" })}
								disabled={
									pending ||
									!valid?.success ||
									valid.data === origin.data?.origin ||
									!origin.isSuccess ||
									origin.isError
								}
								onClick={() => {
									if (valid?.success) save(valid.data);
								}}
							>
								<LuCheck className="size-4" />
							</JedvIconButton>
							<JedvIconButton
								label={t({ message: "Clear" })}
								disabled={pending || !origin.data?.origin || origin.isError}
								onClick={() => save(null)}
							>
								<LuTrash2 className="size-3.5" />
							</JedvIconButton>
						</div>
						<p className="text-[11px] text-muted-foreground">
							<Trans>
								Changing or clearing this address signs out all paired devices.
							</Trans>
						</p>
						{!origin.data?.origin && suggestion?.success && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-auto max-w-full px-0 text-xs"
								disabled={pending}
								onClick={() => setDraft(suggestion.data)}
							>
								<span className="truncate">{suggestion.data}</span>
								<LuPlus className="size-3" />
							</Button>
						)}
					</form>
					{origin.data?.mobileUrl && !origin.isError && (
						<div className="flex min-w-0 items-center gap-1">
							<button
								type="button"
								className="min-w-0 flex-1 truncate rounded text-left text-xs underline focus-visible:ring-2 focus-visible:ring-ring"
								title={origin.data.mobileUrl}
								onClick={() =>
									void electronTrpcClient.external.openUrl
										.mutate(origin.data.mobileUrl ?? "")
										.catch(() => setError(true))
								}
							>
								{origin.data.mobileUrl}
							</button>
							<JedvIconButton
								label={t({ message: "Copy" })}
								onClick={() =>
									void navigator.clipboard
										.writeText(origin.data?.mobileUrl ?? "")
										.then(() =>
											toast.success(t({ message: "Copied to clipboard" })),
										)
										.catch(() => setError(true))
								}
							>
								<LuCopy className="size-3.5" />
							</JedvIconButton>
						</div>
					)}
					{code && (
						<div className="flex min-w-0 items-center gap-2 rounded-md bg-muted p-3">
							<output
								aria-label={t({ message: "Pairing code" })}
								className="min-w-0 flex-1 select-text break-all font-mono text-xl tracking-widest"
							>
								{code.code}
							</output>
							<span className="text-[11px] text-muted-foreground">
								{t({
									message: `Expires ${time}`,
								})}
							</span>
							<JedvIconButton
								label={t({ message: "Copy" })}
								onClick={() =>
									void navigator.clipboard
										.writeText(code.code)
										.catch(() => setError(true))
								}
							>
								<LuCopy className="size-3.5" />
							</JedvIconButton>
						</div>
					)}
					{active.map((session) => (
						<div key={session.id} className="flex min-w-0 items-center gap-2">
							<LuSmartphone className="size-3.5 shrink-0 text-muted-foreground" />
							<span
								className="min-w-0 flex-1 truncate text-xs"
								title={session.id}
							>
								{session.label}
							</span>
							<span className="text-[11px] text-muted-foreground">
								{formatRelativeTime(session.lastSeenAt)}
							</span>
							<JedvIconButton
								label={t({ message: "Revoke session" })}
								disabled={pending || sessions.isError}
								onClick={() =>
									setConfirmation({
										title: t({ message: "Revoke session" }),
										description: t({
											message: "This device will need to pair again.",
										}),
										detail: session.label,
										execute: () =>
											run(() =>
												client.mobileAuth.revokeSession.mutate({
													sessionId: session.id,
												}),
											),
									})
								}
							>
								<LuLogOut className="size-3.5" />
							</JedvIconButton>
						</div>
					))}
					{!!active.length && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 px-0 text-xs text-muted-foreground"
							disabled={pending || sessions.isError}
							onClick={() =>
								setConfirmation({
									title: t({ message: "Revoke all sessions" }),
									description: t({
										message: "This device will need to pair again.",
									}),
									detail: active.map((s) => s.label).join("\n"),
									execute: () =>
										run(() => client.mobileAuth.revokeAllSessions.mutate()),
								})
							}
						>
							<Trans>Revoke all sessions</Trans>
						</Button>
					)}
					{(origin.isError || sessions.isError || error) && (
						<p role="alert" className="text-xs text-destructive">
							<Trans>Operation failed</Trans>
						</p>
					)}
				</>
			)}
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</section>
	);
}
