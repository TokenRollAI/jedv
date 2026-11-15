import { errorMessage } from "@jedv/i18n/errors";
import { formatDateTime, formatNumber } from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LocalClient } from "../../../../local-client";

type Account = Awaited<
	ReturnType<LocalClient["usage"]["quota"]["query"]>
>[number];
export function QuotaAccountRow({
	account,
	client,
	hostUrl,
}: {
	account: Account;
	client: LocalClient;
	hostUrl: string;
}) {
	const cache = useQueryClient();
	const setDefault = useMutation({
		mutationFn: async () => {
			if (account.agent !== "claude" && account.agent !== "codex")
				throw new Error("Unsupported account");
			return client.usage.setDefaultAccount.mutate({
				agent: account.agent,
				selection: account.selection,
			});
		},
		onSuccess: () =>
			cache.invalidateQueries({ queryKey: ["jedv-usage", hostUrl] }),
	});
	return (
		<div className="p-4 space-y-3">
			<div className="flex justify-between gap-4">
				<div>
					<p className="text-sm font-medium">
						{account.agent === "claude"
							? "Claude Code"
							: account.agent === "codex"
								? "Codex"
								: account.agent === "agy"
									? "Antigravity"
									: account.agent}
						<span className="ml-2 text-xs text-muted-foreground">
							{account.email ?? account.sourceLabel}
						</span>
					</p>
					<p className="text-xs text-muted-foreground">
						{account.plan ?? account.credentialKind} · {account.sourceLabel}
					</p>
				</div>
				{account.isDefault ? (
					<span className="text-xs text-muted-foreground">
						<Trans>Default</Trans>
					</span>
				) : (
					(account.agent === "claude" || account.agent === "codex") && (
						<Button
							size="sm"
							variant="outline"
							disabled={setDefault.isPending}
							onClick={() => setDefault.mutate()}
						>
							<Trans>Use for new sessions</Trans>
						</Button>
					)
				)}
			</div>
			{account.status !== "ok" && (
				<output className="text-xs text-muted-foreground">
					{account.statusDetail ?? account.status}
				</output>
			)}
			{account.windows.map((window) => (
				<div key={window.id} className="space-y-1">
					<div className="flex justify-between text-xs">
						<span>{window.label}</span>
						<span className="tabular-nums">
							{formatNumber(window.usedPercent, { maximumFractionDigits: 1 })}%{" "}
							<Trans>used</Trans>
							{window.resetsAt && (
								<>
									{" "}
									· <Trans>resets</Trans> {formatDateTime(window.resetsAt)}
								</>
							)}
						</span>
					</div>
					<div
						role="progressbar"
						aria-label={window.label}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={window.usedPercent}
						className="h-1.5 bg-muted rounded-full overflow-hidden"
					>
						<div
							className="h-full bg-primary/75"
							style={{
								width: `${Math.min(100, Math.max(0, window.usedPercent))}%`,
							}}
						/>
					</div>
				</div>
			))}
			{account.credentialKind === "api_key" && (
				<p className="text-xs text-muted-foreground">
					<Trans>This API login does not expose subscription quota.</Trans>
				</p>
			)}
			{setDefault.error && (
				<p role="alert" className="text-xs text-destructive">
					{errorMessage(setDefault.error)}
				</p>
			)}
		</div>
	);
}
