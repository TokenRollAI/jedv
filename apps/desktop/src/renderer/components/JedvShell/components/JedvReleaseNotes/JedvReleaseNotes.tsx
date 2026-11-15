import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "@jedv/ui/dialog";
import { SidebarCard } from "@jedv/ui/sidebar-card";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useAppVersionHistoryStore } from "renderer/stores/app-version-history";
import { useReleaseNotesCardStore } from "renderer/stores/release-notes-card";
import { shouldShowReleaseCard } from "./release-card";

export function JedvReleaseNotes({
	automatic = false,
}: {
	automatic?: boolean;
}) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const version = electronTrpc.autoUpdate.getVersionInfo.useQuery(undefined, {
		enabled: automatic || open,
		retry: false,
	});
	const history = useAppVersionHistoryStore();
	const dismissed = useReleaseNotesCardStore((state) => state.dismissedVersion);
	const dismiss = useReleaseNotesCardStore((state) => state.dismiss);
	const recorded = useRef(false);
	useEffect(() => {
		if (!automatic || recorded.current || !version.data) return;
		recorded.current = true;
		history.recordBoot(version.data.currentVersion);
	}, [automatic, version.data, history.recordBoot]);
	const showCard =
		automatic &&
		shouldShowReleaseCard(
			version.data?.currentVersion ?? null,
			history.previousVersion,
			dismissed,
		);
	const close = () => {
		if (automatic && version.data) dismiss(version.data.currentVersion);
		setOpen(false);
	};

	const releases = electronTrpc.autoUpdate.openReleaseNotes.useMutation();
	return (
		<>
			{showCard && version.data && (
				<SidebarCard
					title={`Jedv ${version.data.currentVersion}`}
					description={t({ message: "See what changed in this version." })}
					actionLabel={t({ message: "Release notes" })}
					onClick={() => setOpen(true)}
					onAction={() => setOpen(true)}
					onDismiss={close}
				/>
			)}
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (value) setOpen(true);
					else close();
				}}
			>
				{!automatic && (
					<DialogTrigger asChild>
						<Button size="sm" variant="ghost">
							<Trans>Release notes</Trans>
						</Button>
					</DialogTrigger>
				)}
				<DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
					<DialogDescription>
						{version.data
							? `Jedv ${version.data.currentVersion} · ${version.data.channel}`
							: "Jedv"}
					</DialogDescription>
					<DialogTitle>
						<Trans>Included in this build</Trans>
					</DialogTitle>
					<ul className="list-disc space-y-3 pl-5 text-sm text-muted-foreground">
						<li>
							<Trans>
								Local projects, Git worktrees, grouped workspaces, and terminal
								tabs with split panes.
							</Trans>
						</li>
						<li>
							<Trans>Native agent sessions and local attachments.</Trans>
						</li>
						<li>
							<Trans>
								Files, Git changes, pull requests, project scripts, and port
								forwarding.
							</Trans>
						</li>
						<li>
							<Trans>
								Private host connections and application settings without a Jedv
								account.
							</Trans>
						</li>
					</ul>
					<p className="text-xs text-muted-foreground">
						<Trans>
							These notes ship with the application. Published release details
							are available in the Jedv repository.
						</Trans>
					</p>
					{(version.error || releases.error) && (
						<p role="alert" className="text-xs text-destructive">
							{errorMessage(version.error ?? releases.error)}
						</p>
					)}
					<div className="flex gap-2">
						<Button onClick={close}>
							<Trans>Got it</Trans>
						</Button>
						<Button
							variant="ghost"
							disabled={releases.isPending}
							onClick={() => releases.mutate()}
						>
							{t({ message: "All releases" })} ↗
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
