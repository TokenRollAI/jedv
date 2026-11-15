import { errorMessage } from "@jedv/i18n/errors";
import { formatDateTime, formatNumber } from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuCircleArrowUp, LuCircleCheck, LuRefreshCw } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { CountdownBorder } from "./CountdownBorder";
import { DownloadRing } from "./DownloadRing";
import { updateDisplayState } from "./update-state";
import { useAutoUpdateStatus } from "./useAutoUpdateStatus";

export interface UpdatesPillProps {
	isCollapsed?: boolean;
	variant?: "sidebar" | "settings";
}

export function UpdatesPill({
	isCollapsed = false,
	variant = "sidebar",
}: UpdatesPillProps) {
	const { t } = useLingui();
	const query = useAutoUpdateStatus();
	const check = electronTrpc.autoUpdate.check.useMutation({
		onSuccess: () => query.refetch(),
	});
	const install = electronTrpc.autoUpdate.install.useMutation({
		onSettled: () => query.refetch(),
	});
	const dismiss = electronTrpc.autoUpdate.dismiss.useMutation();
	const releases = electronTrpc.autoUpdate.openReleaseNotes.useMutation();
	const [confirmationDone, setConfirmationDone] = useState(false);
	const event = query.data;
	const state = event ? updateDisplayState(event) : null;
	useEffect(() => {
		setConfirmationDone(false);
		if (state !== "updated") return;
		const timer = setTimeout(() => setConfirmationDone(true), 5_000);
		return () => clearTimeout(timer);
	}, [state]);
	const error =
		check.error ??
		install.error ??
		dismiss.error ??
		releases.error ??
		query.error;
	const busy =
		check.isPending ||
		install.isPending ||
		!!event?.installing ||
		state === "checking" ||
		state === "downloading";
	let label = t({ message: "Not checked yet" });
	if (!event)
		label = query.isPending
			? t({ message: "Loading…" })
			: t({ message: "Update status unavailable" });
	else if (state === "unavailable")
		label =
			event.reason ??
			t({ message: "Automatic updates are unavailable for this build." });
	else if (state === "up-to-date") label = t({ message: "You're up to date" });
	else if (state === "checking")
		label = t({ message: "Checking for updates…" });
	else if (state === "downloading") {
		const percent = event.progress
			? formatNumber(event.progress.percent, { maximumFractionDigits: 0 })
			: null;
		const version = event.version
			? `v${event.version}`
			: t({ message: "update" });
		label =
			percent === null
				? t({ message: `Downloading ${version}…` })
				: t({ message: `Downloading ${version} · ${percent}%` });
	} else if (state === "installing")
		label = t({ message: "Installing update…" });
	else if (state === "ready")
		label = t({ message: `Restart to install v${event.version ?? ""}` });
	else if (state === "deferred" || state === "manual-update")
		label = t({ message: `Update available · v${event.version ?? ""}` });
	else if (state === "updated")
		label = t({
			message: `Updated to v${event.version ?? event.currentVersion}`,
		});
	else if (state === "error")
		label = event.error ?? t({ message: "Update failed. Try again." });
	const action = () => {
		if (busy) return;
		if (state === "ready") install.mutate();
		else if (state === "manual-update") releases.mutate();
		else check.mutate();
	};
	const icon =
		state === "downloading" ? (
			<DownloadRing
				percent={event?.progress?.percent ?? null}
				className="size-3.5"
			/>
		) : state === "updated" ? (
			<LuCircleCheck className="size-3.5" />
		) : state === "checking" || state === "installing" ? (
			<LuRefreshCw className="size-3.5 animate-spin" />
		) : (
			<LuCircleArrowUp className="size-3.5" />
		);
	if (variant === "sidebar") {
		if (
			![
				"downloading",
				"ready",
				"error",
				"updated",
				"installing",
				"checking",
				"manual-update",
			].includes(state ?? "") ||
			(state === "updated" && confirmationDone)
		)
			return null;
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						disabled={busy || state === "updated"}
						onClick={action}
						aria-label={label}
						className={`relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full px-2 py-1 font-mono text-[10px] ring-1 ring-inset ring-foreground/10 hover:bg-accent ${state === "error" ? "text-destructive" : "text-muted-foreground"} ${isCollapsed ? "size-8" : ""}`}
					>
						{state === "updated" && (
							<CountdownBorder durationMs={5000} radius="pill" />
						)}
						{icon}
						{!isCollapsed && <span className="max-w-40 truncate">{label}</span>}
					</button>
				</TooltipTrigger>
				<TooltipContent side="right">
					{error ? errorMessage(error) : label}
				</TooltipContent>
			</Tooltip>
		);
	}
	return (
		<div className="flex max-w-lg flex-col items-end gap-2 text-xs">
			<output className="text-right text-muted-foreground">{label}</output>
			{event?.availability === "unsigned" && (
				<p className="text-right text-muted-foreground">
					<Trans>Updates require manual installation for this build.</Trans>
				</p>
			)}
			{event?.checkedAt && (
				<p className="text-muted-foreground">
					<Trans>Last check completed</Trans>
					{" · "}
					<time dateTime={new Date(event.checkedAt).toISOString()}>
						{formatDateTime(event.checkedAt)}
					</time>
				</p>
			)}
			{error && (
				<p role="alert" className="text-destructive">
					{errorMessage(error)}
				</p>
			)}
			<div className="flex flex-wrap justify-end gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={busy || (!!event && state === "unavailable")}
					onClick={action}
				>
					{icon}
					{state === "ready" ? (
						<Trans>Restart to update</Trans>
					) : state === "manual-update" ? (
						<Trans>Download update</Trans>
					) : state === "deferred" ? (
						<Trans>Show update</Trans>
					) : (
						<Trans>Check for updates</Trans>
					)}
				</Button>
				{state === "ready" && (
					<Button
						size="sm"
						variant="ghost"
						disabled={dismiss.isPending}
						onClick={() => dismiss.mutate()}
					>
						<Trans>Later</Trans>
					</Button>
				)}
			</div>
		</div>
	);
}
