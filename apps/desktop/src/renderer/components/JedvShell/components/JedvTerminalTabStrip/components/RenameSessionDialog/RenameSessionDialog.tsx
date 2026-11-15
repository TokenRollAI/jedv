import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { redactProjectError } from "../../../JedvProjectActions/project-utils";
import {
	paneTerminalId,
	type TerminalLayoutStore,
	workspaceAreaStores,
} from "../../../JedvTerminalWorkspace/layout";
import type { SessionPickerContext } from "../../types";
export function RenameSessionDialog({
	target,
	terminalId,
	initialName,
	store,
	onClose,
	isCurrent = () => true,
}: {
	target: SessionPickerContext;
	terminalId: string;
	initialName: string;
	store: TerminalLayoutStore;
	onClose(): void;
	isCurrent?(): boolean;
}) {
	const { t } = useLingui();
	const [name, setName] = useState(initialName);
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const cache = useQueryClient();
	return (
		<Dialog
			open
			modal
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent showCloseButton={!pending} className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						<Trans>Rename session</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Leave it empty to go back to the name the terminal reports.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-4"
					onSubmit={async (event) => {
						event.preventDefault();
						if (!isCurrent()) {
							onClose();
							return;
						}
						if (busy.current) return;
						busy.current = true;
						setPending(true);
						setError(null);
						try {
							if (!saved) {
								await target.client.terminal.rename.mutate({
									workspaceId: target.workspaceId,
									terminalId,
									title: name,
								});
								if (!isCurrent()) {
									onClose();
									return;
								}
								setSaved(true);
								for (const area of workspaceAreaStores(store))
									for (const tab of area.getState().tabs)
										for (const pane of Object.values(tab.panes))
											if (paneTerminalId(pane) === terminalId)
												area.getState().setPaneTitleOverride({
													tabId: tab.id,
													paneId: pane.id,
													titleOverride: undefined,
												});
							}
							await cache.refetchQueries(
								{
									queryKey: [
										"jedv",
										target.hostUrl,
										"terminals",
										target.workspaceId,
									],
								},
								{ throwOnError: true },
							);
							if (isCurrent()) onClose();
						} catch (failure) {
							setError(
								redactProjectError(
									failure instanceof Error
										? failure.message
										: t({
												message:
													"Could not rename this session. Your draft is kept.",
											}),
								),
							);
						} finally {
							busy.current = false;
							setPending(false);
						}
					}}
				>
					<Input
						autoFocus
						aria-label={t({ message: "Session name" })}
						value={name}
						maxLength={1000}
						disabled={pending || saved}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								(event.nativeEvent.isComposing ||
									event.nativeEvent.keyCode === 229)
							)
								event.preventDefault();
						}}
					/>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button
							variant="ghost"
							type="button"
							disabled={pending}
							onClick={onClose}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button disabled={pending} type="submit">
							{pending ? (
								<Trans>Saving…</Trans>
							) : saved ? (
								<Trans>Finish refreshing</Trans>
							) : (
								<Trans>Save</Trans>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
