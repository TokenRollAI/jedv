import type { TeardownFailureCause } from "@jedv/host-service";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	EnterEnabledAlertDialogContent,
} from "@jedv/ui/alert-dialog";
import { Trans } from "@lingui/react/macro";
import stripAnsi from "strip-ansi";
import { shouldConfirmDeleteDialogKey } from "../utils/shouldConfirmDeleteDialogKey";
import { formatTeardownReason } from "./formatTeardownReason";

interface TeardownFailedPaneProps {
	pending?: boolean;
	children?: import("react").ReactNode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	cause: TeardownFailureCause;
	onForceDelete: () => void;
}

export function TeardownFailedPane({
	open,
	pending = false,
	children,
	onOpenChange,
	cause,
	onForceDelete,
}: TeardownFailedPaneProps) {
	const reason = formatTeardownReason(cause);

	const cleanTail = stripAnsi(cause.outputTail ?? "");

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<EnterEnabledAlertDialogContent className="max-w-[500px] gap-0 p-0">
				<AlertDialogHeader className="px-4 pt-4 pb-2">
					<AlertDialogTitle className="font-medium">{reason}</AlertDialogTitle>
					<AlertDialogDescription>
						<Trans>Delete anyway will skip the teardown script entirely.</Trans>
					</AlertDialogDescription>
				</AlertDialogHeader>
				{cleanTail && (
					<pre className="mx-4 mb-2 max-h-48 overflow-auto rounded border bg-muted px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
						{cleanTail}
					</pre>
				)}
				{children}
				<AlertDialogFooter className="px-4 pb-4 pt-2 flex-row justify-end gap-2">
					<AlertDialogCancel
						disabled={pending}
						className="h-7 border-0 bg-transparent px-3 text-xs shadow-none"
					>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<AlertDialogAction
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								!shouldConfirmDeleteDialogKey(event.nativeEvent)
							) {
								event.preventDefault();
							}
						}}
						disabled={pending}
						variant="destructive"
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={(event) => {
							event.preventDefault();
							onForceDelete();
						}}
					>
						<Trans>Delete anyway</Trans>
					</AlertDialogAction>
				</AlertDialogFooter>
			</EnterEnabledAlertDialogContent>
		</AlertDialog>
	);
}
