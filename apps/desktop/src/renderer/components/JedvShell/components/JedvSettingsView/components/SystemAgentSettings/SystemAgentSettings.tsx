import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { LuCheck, LuRefreshCw, LuTrash2 } from "react-icons/lu";
import type { JedvParityViewContext } from "../../../../parity-types";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../JedvConfirmDialog/JedvConfirmDialog";
import { JedvIconButton } from "../../../JedvIconButton";
export function SystemAgentSettings({
	client,
	hostUrl,
}: Pick<JedvParityViewContext, "client" | "hostUrl">) {
	const { t } = useLingui();
	const cache = useQueryClient();
	const [key, setKey] = useState(""),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const busy = useRef(false);
	const queryKey = ["jedv", hostUrl, "ai-settings"];
	const settings = useQuery({
		queryKey,
		queryFn: () => client.aiSettings.get.query(),
		retry: false,
		gcTime: 30_000,
		refetchInterval: 30_000,
	});
	const save = async (apiKey: string | null) => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setError(false);
		try {
			const result = await client.aiSettings.setDeepseekKey.mutate({ apiKey });
			cache.setQueryData(queryKey, {
				configured: result.configured,
				maskedHint: result.maskedHint,
			});
		} catch {
			setError(true);
			throw new Error("Unable to update DeepSeek key");
		} finally {
			setKey("");
			busy.current = false;
			setPending(false);
		}
	};
	return (
		<section className="space-y-4" aria-label={t({ message: "System agents" })}>
			<p className="text-xs leading-relaxed text-muted-foreground">
				<Trans>
					Without a key, teams, mail, active memory and rule alerts remain
					available.
				</Trans>
			</p>
			<form
				className="space-y-3 rounded-lg border border-border bg-card p-4"
				onSubmit={(event) => {
					event.preventDefault();
					if (key.trim() && !pending && settings.isSuccess && !settings.isError)
						void save(key.trim()).catch(() => {});
				}}
			>
				<div className="flex items-center gap-2">
					<label
						htmlFor="deepseek-api-key"
						className="flex-1 text-xs font-medium"
					>
						<Trans>DeepSeek API Key</Trans>
					</label>
					<span className="text-[11px] text-muted-foreground">
						{settings.isPending
							? t({ message: "Loading…" })
							: settings.data?.configured
								? `${t({ message: "Configured" })} · ${settings.data.maskedHint ?? ""}`
								: t({ message: "Not configured" })}
					</span>
				</div>
				<div className="flex items-center gap-2">
					<Input
						id="deepseek-api-key"
						type="password"
						autoComplete="new-password"
						spellCheck={false}
						maxLength={512}
						placeholder={
							settings.data?.configured
								? t({ message: "Enter a new API key to replace it" })
								: t({ message: "Enter DeepSeek API Key" })
						}
						value={key}
						disabled={pending || !settings.isSuccess || settings.isError}
						onChange={(event) => setKey(event.target.value)}
						className="h-8 flex-1 text-xs"
					/>
					<JedvIconButton
						label={t({ message: "Save API key" })}
						type="submit"
						disabled={
							pending || !key.trim() || !settings.isSuccess || settings.isError
						}
					>
						<LuCheck className="size-4" />
					</JedvIconButton>
					<JedvIconButton
						label={t({ message: "Clear API key" })}
						disabled={pending || !settings.data?.configured || settings.isError}
						onClick={() =>
							setConfirmation({
								title: t({ message: "Clear API key?" }),
								description: t({
									message:
										"Without a key, teams, mail, active memory and rule alerts remain available.",
								}),
								detail: hostUrl,
								execute: () => save(null),
							})
						}
					>
						<LuTrash2 className="size-3.5" />
					</JedvIconButton>
				</div>
				<p className="text-[11px] leading-relaxed text-muted-foreground">
					<Trans>
						The key stays on this host. It is never injected into terminals or
						returned to this screen.
					</Trans>
				</p>
				{(error || settings.isError) && (
					<div
						role="alert"
						className="flex items-center gap-2 text-xs text-destructive"
					>
						<span className="flex-1">
							<Trans>
								Could not update DeepSeek settings. Check the host and retry.
							</Trans>
						</span>
						<JedvIconButton
							label={t({ message: "Retry" })}
							disabled={pending}
							onClick={() => {
								setError(false);
								void settings.refetch();
							}}
						>
							<LuRefreshCw className="size-3.5" />
						</JedvIconButton>
					</div>
				)}
			</form>
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</section>
	);
}
