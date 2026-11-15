import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
export function RemoteWriteNotice({
	refreshing,
	onRefresh,
}: {
	refreshing: boolean;
	onRefresh(): Promise<void>;
}) {
	const [error, setError] = useState<string | null>(null);
	return (
		<div
			role="alert"
			className="flex flex-wrap items-center gap-2 p-2 text-xs text-destructive"
		>
			<span>
				<Trans>Result unknown. Refresh before retrying.</Trans>
			</span>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={refreshing}
				onClick={() => {
					setError(null);
					void onRefresh().catch((error) =>
						setError(error instanceof Error ? error.message : String(error)),
					);
				}}
			>
				<Trans>Refresh</Trans>
			</Button>
			{error && <span>{error}</span>}
		</div>
	);
}
