import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
export function BranchLoadFailure({
	isRetrying,
	onRetry,
}: {
	error: unknown;
	isRetrying: boolean;
	onRetry(): void;
	onChangeProjectLocation?: () => void;
}) {
	return (
		<span className="flex items-center gap-2 text-xs">
			<span role="alert" className="text-destructive">
				<Trans>Could not load branches from the target host.</Trans>
			</span>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				disabled={isRetrying}
				onClick={onRetry}
			>
				<Trans>Retry</Trans>
			</Button>
		</span>
	);
}
