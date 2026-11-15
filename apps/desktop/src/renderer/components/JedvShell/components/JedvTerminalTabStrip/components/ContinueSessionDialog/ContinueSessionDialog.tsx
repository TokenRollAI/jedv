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
import { useRef, useState } from "react";
import { redactProjectError } from "../../../JedvProjectActions/project-utils";
import { ExistingSessionError } from "../../../NativeAgentControls/components/AgentSessionPicker/utils/resume-existing";
import type { SessionPickerContext } from "../../types";
import { continueTerminalSession } from "../../utils/continue-session";
import type { SessionContinuation } from "../../utils/session-list";
export function ContinueSessionDialog({
	target,
	continuation,
	title,
	isCurrent,
	onClose,
}: {
	target: SessionPickerContext;
	continuation: SessionContinuation;
	title: string;
	isCurrent(): boolean;
	onClose(): void;
}) {
	const { t } = useLingui();
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const id =
		continuation.kind === "live"
			? (continuation.binding.agentSessionId ??
				continuation.binding.chatSessionId)
			: continuation.candidate.nativeSessionId;
	return (
		<Dialog
			open
			modal
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent className="sm:max-w-md" showCloseButton={!pending}>
				<DialogHeader>
					<DialogTitle>
						<Trans>Continue with agent</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Continue this exact existing session. A new agent session will not
							be started.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-1 break-words text-xs">
					<p className="font-medium">{title}</p>
					<p>{target.hostUrl}</p>
					<p className="font-mono">{id}</p>
				</div>
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				<DialogFooter>
					<Button variant="ghost" disabled={pending} onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						disabled={pending}
						onClick={async () => {
							if (busy.current) return;
							busy.current = true;
							setPending(true);
							setError(null);
							try {
								if (!isCurrent())
									throw new Error(
										t({
											message:
												"The target workspace changed. Return to the original workspace before continuing.",
										}),
									);
								const selection = await continueTerminalSession(
									target,
									continuation,
								);
								if (!isCurrent())
									throw new Error(
										t({
											message:
												"The target workspace changed. The result belongs to the original workspace.",
										}),
									);
								await target.onSelectSession(selection);
								onClose();
							} catch (failure) {
								setError(
									failure instanceof ExistingSessionError
										? failure.reason === "identity-changed"
											? t({
													message:
														"The existing session identity could not be verified. Refresh before retrying.",
												})
											: t({
													message:
														"Same-session control is unavailable. No new agent session was started.",
												})
										: redactProjectError(
												failure instanceof Error
													? failure.message
													: t({
															message:
																"Could not confirm this session. Refresh before retrying.",
														}),
											),
								);
							} finally {
								busy.current = false;
								setPending(false);
							}
						}}
					>
						{pending ? (
							<Trans>Continuing…</Trans>
						) : (
							<Trans>Continue same session</Trans>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
