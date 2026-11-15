import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import type { SetupLaunchBlocker } from "../../hooks/useAgentLaunchGuard/useAgentLaunchGuard";
export function AgentSetupGuard({
	blocker,
	checking,
	onRefresh,
	onDismiss,
	onOpenSetup,
	onSettings,
}: {
	blocker: SetupLaunchBlocker | null;
	checking: boolean;
	onRefresh(): Promise<void>;
	onDismiss(): void;
	onOpenSetup(workspaceId: string, terminalId: string): Promise<void>;
	onSettings(): void;
}) {
	const { t } = useLingui();
	const [opening, setOpening] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!blocker) setError(null);
	}, [blocker]);
	return (
		<Dialog
			open={!!blocker}
			onOpenChange={(open) => {
				if (!open) onDismiss();
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>
						<Trans>Agent launch is waiting for setup</Trans>
					</DialogTitle>
					<DialogDescription>
						{blocker?.state?.status === "running" ? (
							<Trans>Workspace setup is still running.</Trans>
						) : blocker?.state?.status === "failed" ? (
							<Trans>
								Workspace setup failed. Review the setup terminal before
								starting an agent.
							</Trans>
						) : (
							<Trans>
								Setup completion is unavailable for this workspace. Review setup
								or turn off waiting in settings.
							</Trans>
						)}
					</DialogDescription>
				</DialogHeader>
				{blocker?.state?.status === "failed" && (
					<p className="text-xs text-muted-foreground">
						{t({
							message: `Exit code: ${blocker.state.exitCode ?? "—"}; signal: ${blocker.state.exitSignal ?? "—"}`,
						})}
					</p>
				)}
				{(error || blocker?.error) && (
					<p
						role="alert"
						className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-destructive"
					>
						{error ?? blocker?.error}
					</p>
				)}
				<p className="text-xs text-muted-foreground">
					<Trans>
						No agent was started. After setup completes, start the agent again.
					</Trans>
				</p>
				<DialogFooter className="flex-wrap gap-2">
					<Button variant="outline" onClick={onDismiss} autoFocus>
						<Trans>Cancel</Trans>
					</Button>
					{blocker?.state?.terminalId && (
						<Button
							variant="outline"
							disabled={opening}
							onClick={() => {
								if (!blocker.state?.terminalId) return;
								setOpening(true);
								setError(null);
								void onOpenSetup(blocker.workspaceId, blocker.state.terminalId)
									.then(onDismiss)
									.catch((cause) =>
										setError(
											cause instanceof Error ? cause.message : String(cause),
										),
									)
									.finally(() => setOpening(false));
							}}
						>
							<Trans>Open setup terminal</Trans>
						</Button>
					)}
					<Button
						variant="outline"
						onClick={() => {
							onDismiss();
							onSettings();
						}}
					>
						<Trans>Open settings</Trans>
					</Button>
					<Button disabled={checking} onClick={() => void onRefresh()}>
						<Trans>Refresh status</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
