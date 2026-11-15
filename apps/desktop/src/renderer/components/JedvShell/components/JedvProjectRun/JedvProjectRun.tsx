import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../JedvConfirmDialog/JedvConfirmDialog";
import {
	WorkspaceActionsMenu,
	type WorkspaceMenuContext,
} from "./components/WorkspaceActionsMenu";
import {
	type ProjectRunOptions,
	useProjectRun,
} from "./hooks/useProjectRun/useProjectRun";
export function JedvProjectRun(
	props: ProjectRunOptions &
		WorkspaceMenuContext & {
			runRef: { current: (() => Promise<void>) | null };
		},
) {
	const run = useProjectRun(props);
	const { t } = useLingui();
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const running = run.status.data?.running === true && !run.record?.exited;
	useEffect(() => {
		const action = () => run.execute(running ? "stop" : "run");
		props.runRef.current = action;
		return () => {
			if (props.runRef.current === action) props.runRef.current = null;
		};
	});
	return (
		<div className="flex items-center gap-1">
			<WorkspaceActionsMenu
				title={props.title}
				worktreePath={props.worktreePath}
				remote={props.remote}
				anchorRef={props.anchorRef}
				onOpenFiles={props.onOpenFiles}
				onForwardPorts={props.onForwardPorts}
				onOpenAgent={props.onOpenAgent}
				pendingApprovals={props.pendingApprovals}
				definition={run.definition.data ?? null}
				isRunning={running}
				isPending={run.pending || run.definition.isPending}
				canForceStop={!!run.record && !!run.status.data?.exists}
				hasTerminal={!!run.status.data?.exists}
				onToggle={() => run.execute(running ? "stop" : "run")}
				onConfigure={props.onConfigure}
				onOpen={() => void run.execute("open")}
				onRestart={() => void run.execute("restart")}
				onNew={() => void run.execute("new")}
				onForceStop={() =>
					setConfirmation({
						title: t({ message: "Force Stop" }),
						description: t({
							message:
								"This closes the run terminal and its running processes.",
						}),
						detail: run.record?.terminalId ?? "",
						execute: () => run.execute("force"),
					})
				}
				status={
					run.record && (
						<>
							{run.record.uncertain ? (
								<Trans>Result unknown</Trans>
							) : run.record.exited || run.status.data?.exists === false ? (
								<Trans>Exited</Trans>
							) : running ? (
								<Trans>Running</Trans>
							) : (
								<Trans>Idle</Trans>
							)}
							{run.record.exitCode !== undefined
								? ` (${run.record.exitCode})`
								: null}
						</>
					)
				}
				error={run.status.error?.message ?? run.definition.error?.message}
			/>
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</div>
	);
}
