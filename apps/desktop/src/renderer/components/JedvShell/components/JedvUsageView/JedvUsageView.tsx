import { errorMessage } from "@jedv/i18n/errors";
import {
	formatCompactNumber,
	formatCurrency,
	formatDateTime,
	formatNumber,
} from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { JedvParityViewContext } from "../../parity-types";
import {
	useWindowChrome,
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "../WindowChrome";
import { QuotaAccountRow } from "./components/QuotaAccountRow/QuotaAccountRow";
export function JedvUsageView({ client, hostUrl }: JedvParityViewContext) {
	const { t } = useLingui();
	const [days, setDays] = useState(30);
	const cache = useQueryClient();
	const history = useQuery({
		queryKey: ["jedv-usage", hostUrl, "history", days],
		queryFn: () => client.usage.history.query({ days }),
		staleTime: 60_000,
	});
	const quota = useQuery({
		queryKey: ["jedv-usage", hostUrl, "quota"],
		queryFn: () => client.usage.quota.query(),
		staleTime: 300_000,
	});
	const logins = useQuery({
		queryKey: ["jedv-usage", hostUrl, "logins"],
		queryFn: () => client.usage.logins.query(),
		staleTime: 60_000,
	});
	const refresh = useMutation({
		mutationFn: () => client.usage.quota.query({ forceRefresh: true }),
		onSuccess: (data) =>
			cache.setQueryData(["jedv-usage", hostUrl, "quota"], data),
	});
	const [detail, setDetail] = useState<string | null>(null);
	const data = history.data;
	const embedded = useWindowChrome().surface === "settings";
	const selected = detail
		? (data?.modelDetails[detail] ?? data?.projectDetails[detail])
		: null;
	const claudeCount =
		logins.data?.claude.length ??
		quota.data?.filter((account) => account.agent === "claude").length ??
		0;
	const codexCount =
		logins.data?.codex.length ??
		quota.data?.filter((account) => account.agent === "codex").length ??
		0;
	const agyCount =
		quota.data?.filter((account) => account.agent === "agy").length ?? 0;
	const periodSelect = (
		<Select
			value={String(days)}
			onValueChange={(value) => {
				setDays(Number(value));
				setDetail(null);
			}}
		>
			<SelectTrigger
				size="sm"
				className="w-36"
				aria-label={t({ message: "Usage period" })}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{[7, 30, 90].map((n) => (
					<SelectItem key={n} value={String(n)}>
						{t({ message: `Last ${n} days` })}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
	const body = (
		<div
			className={
				embedded ? "space-y-6" : "mx-auto w-full max-w-5xl space-y-6 p-6"
			}
		>
			{!embedded && (
				<p className="text-sm text-muted-foreground">
					<Trans>
						Local CLI history and provider quota for the connected host.
					</Trans>
				</p>
			)}
			<section className="space-y-3">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-medium">
						<Trans>Provider quota</Trans>
					</h3>
					<Button
						variant="ghost"
						size="sm"
						disabled={quota.isFetching || refresh.isPending}
						onClick={() => refresh.mutate()}
					>
						<Trans>Refresh</Trans>
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					<Trans>
						Quota is read from your provider. Refreshing may contact the
						provider using your existing CLI login.
					</Trans>
				</p>
				{(quota.isPending || logins.isPending) && (
					<output className="text-sm text-muted-foreground">
						<Trans>Loading quota…</Trans>
					</output>
				)}
				{(quota.error || refresh.error) && (
					<p role="alert" className="text-sm text-destructive">
						{errorMessage(quota.error ?? refresh.error)}
					</p>
				)}
				{quota.data && (
					<div className="rounded-lg border border-border divide-y overflow-hidden">
						{quota.data.map((account) => (
							<QuotaAccountRow
								key={account.accountKey}
								account={account}
								client={client}
								hostUrl={hostUrl}
							/>
						))}
						{quota.data.length === 0 && (
							<p className="p-4 text-sm text-muted-foreground">
								<Trans>
									No provider quota is available. Sign in with an agent CLI,
									then refresh.
								</Trans>
							</p>
						)}
						<p className="p-4 text-xs text-muted-foreground">
							<strong>Kimi Code</strong> ·{" "}
							<Trans>No local usage or quota data is available.</Trans>
						</p>
					</div>
				)}
				{(logins.data || quota.data) && !quota.isPending && (
					<p className="text-xs text-muted-foreground">
						{t({
							message: `Discovered ${formatNumber(claudeCount)} Claude Code, ${formatNumber(codexCount)} Codex, and ${formatNumber(agyCount)} Antigravity accounts on this host. Kimi Code does not expose local account discovery.`,
						})}
					</p>
				)}
				{logins.isError && (
					<p role="alert" className="text-xs text-destructive">
						{errorMessage(logins.error)}
					</p>
				)}
			</section>
			<section className="space-y-3">
				<div className="flex flex-wrap justify-between items-center gap-2">
					<h3 className="text-sm font-medium">
						<Trans>Usage history</Trans>
					</h3>
					<div className="flex items-center gap-2">
						{embedded && periodSelect}
						<Button
							size="sm"
							variant="ghost"
							disabled={history.isFetching}
							onClick={() => void history.refetch()}
						>
							<Trans>Refresh history</Trans>
						</Button>
					</div>
				</div>
				<p className="text-xs text-muted-foreground">
					<Trans>
						Costs are estimates based on API list rates, not a bill or actual
						subscription spending. Unknown models use approximate rates.
					</Trans>
				</p>
				{history.isPending && (
					<output className="text-sm text-muted-foreground">
						<Trans>Reading local CLI logs…</Trans>
					</output>
				)}
				{history.error && (
					<p role="alert" className="text-sm text-destructive">
						{errorMessage(history.error)}
					</p>
				)}
				{data && (
					<>
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-y py-3">
							<div>
								<p className="text-[11px] text-muted-foreground">
									<Trans>Estimated cost</Trans>
								</p>
								<p className="text-lg font-medium tabular-nums">
									{data.totals.approximate ? "≈ " : ""}
									{formatCurrency(data.totals.usd, "USD")}
								</p>
							</div>
							<div>
								<p className="text-[11px] text-muted-foreground">
									<Trans>Processed tokens</Trans>
								</p>
								<p className="text-lg font-medium tabular-nums">
									{formatCompactNumber(data.totals.tokens)}
								</p>
							</div>
							<div>
								<p className="text-[11px] text-muted-foreground">
									<Trans>Cached input</Trans>
								</p>
								<p className="text-lg font-medium tabular-nums">
									{formatCompactNumber(data.totals.cachedInput)}
								</p>
							</div>
							<div>
								<p className="text-[11px] text-muted-foreground">
									<Trans>Output</Trans>
								</p>
								<p className="text-lg font-medium tabular-nums">
									{formatCompactNumber(data.totals.output)}
								</p>
							</div>
						</div>
						{data.scannedFiles === 0 && (
							<p className="py-4 text-sm text-muted-foreground">
								<Trans>No usage logs were found for this period.</Trans>
							</p>
						)}
						{data.buckets.some((bucket) => bucket.tokens > 0) && (
							<section
								className="space-y-1"
								aria-label={t({ message: "Daily token history" })}
							>
								{data.buckets.map((bucket) => (
									<div
										key={bucket.day}
										className="grid grid-cols-[88px_1fr_70px] gap-3 items-center text-[11px]"
									>
										<span className="text-muted-foreground">{bucket.day}</span>
										<div className="h-2 rounded-sm bg-muted">
											<div
												className="h-full bg-primary/70 rounded-sm"
												style={{
													width: `${Math.max(0, (bucket.tokens / Math.max(1, ...data.buckets.map((day) => day.tokens))) * 100)}%`,
												}}
											/>
										</div>
										<span className="text-right tabular-nums">
											{formatCompactNumber(bucket.tokens)}
										</span>
									</div>
								))}
							</section>
						)}
						<div className="grid gap-6 lg:grid-cols-2">
							<div>
								<h4 className="text-sm font-medium mb-2">
									<Trans>Models</Trans>
								</h4>
								<table className="w-full text-xs">
									<thead className="border-b text-muted-foreground">
										<tr>
											<th className="text-left py-2 font-medium">
												<Trans>Model</Trans>
											</th>
											<th className="text-right py-2 font-medium">
												<Trans>Estimated cost</Trans>
											</th>
											<th className="text-right py-2 font-medium">
												<Trans>Tokens</Trans>
											</th>
										</tr>
									</thead>
									<tbody>
										{data.models.map((model) => (
											<tr
												key={`${model.agent}|${model.model}`}
												className="border-b border-border/50"
											>
												<td className="py-2">
													<button
														type="button"
														className="text-left hover:underline"
														onClick={() =>
															setDetail(`${model.agent}|${model.model}`)
														}
													>
														{model.model}
														<span className="block text-[11px] text-muted-foreground">
															{model.agent}
														</span>
													</button>
												</td>
												<td className="text-right tabular-nums">
													{model.approximate ? "≈ " : ""}
													{formatCurrency(model.usd, "USD")}
												</td>
												<td className="text-right tabular-nums">
													{formatCompactNumber(model.tokens)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<div>
								<h4 className="text-sm font-medium mb-2">
									<Trans>Projects and workspaces</Trans>
								</h4>
								<table className="w-full text-xs">
									<tbody>
										{data.projects.map((project) => (
											<tr
												key={project.project}
												className="border-b border-border/50"
											>
												<td className="py-2">
													<button
														type="button"
														className="text-left hover:underline"
														disabled={!data.projectDetails[project.project]}
														onClick={() => setDetail(project.project)}
													>
														{project.project}
														{project.group && (
															<span className="block text-[11px] text-muted-foreground">
																{project.group}
															</span>
														)}
													</button>
												</td>
												<td className="text-right tabular-nums">
													{formatCurrency(project.usd, "USD")}
												</td>
												<td className="text-right tabular-nums">
													{formatCompactNumber(project.tokens)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
						{selected && (
							<section className="border-t pt-4">
								<div className="flex items-center justify-between">
									<h4 className="text-sm font-medium">{detail}</h4>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setDetail(null)}
									>
										<Trans>Close details</Trans>
									</Button>
								</div>
								{selected.breakdown.map((row) => (
									<div
										key={`${row.agent}:${row.label}`}
										className="flex justify-between gap-4 py-2 border-b border-border/50 text-xs"
									>
										<span className="min-w-0 truncate">
											{row.label}
											<span className="ml-2 text-muted-foreground">
												{row.agent}
											</span>
										</span>
										<span className="shrink-0 tabular-nums">
											{formatCompactNumber(row.tokens)} ·{" "}
											{formatCurrency(row.usd, "USD")}
										</span>
									</div>
								))}
								{selected.sessions?.map((session) => (
									<div
										className="py-2 flex justify-between gap-4 text-xs border-b border-border/50"
										key={session.id}
									>
										<span className="truncate">
											{session.label ?? session.id}
											<span className="block text-muted-foreground">
												{formatDateTime(session.lastMs)}
											</span>
										</span>
										<span className="shrink-0 tabular-nums">
											{formatCompactNumber(session.tokens)} ·{" "}
											{formatCurrency(session.usd, "USD")}
										</span>
									</div>
								))}
							</section>
						)}
						<p className="text-[11px] text-muted-foreground">
							{t({
								message: `Scanned ${data.scannedFiles} log files. Pricing table: ${data.pricingTableUpdated}.`,
							})}
						</p>
					</>
				)}
			</section>
		</div>
	);
	if (embedded) return body;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<WindowChrome primary className="gap-2 border-b border-border pr-3">
				<WindowChromeLeading />
				<WindowChromeControls className="min-w-0 pl-3">
					<h2 className="truncate text-[13.5px] font-medium">
						<Trans>Usage</Trans>
					</h2>
				</WindowChromeControls>
				<div className="drag min-w-4 flex-1" />
				<WindowChromeControls className="shrink-0">
					{periodSelect}
				</WindowChromeControls>
				<WindowControlsInset />
			</WindowChrome>
			<div className="min-h-0 flex-1 overflow-auto">{body}</div>
		</div>
	);
}
