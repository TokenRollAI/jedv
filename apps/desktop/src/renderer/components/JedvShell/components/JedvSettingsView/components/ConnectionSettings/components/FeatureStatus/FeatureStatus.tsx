import { Trans, useLingui } from "@lingui/react/macro";
import { LuRefreshCw } from "react-icons/lu";
import { JedvIconButton } from "../../../../../JedvIconButton";
export function FeatureStatus({
	loading,
	retry,
}: {
	loading: boolean;
	retry(): void;
}) {
	const { t } = useLingui();
	return (
		<div
			role={loading ? "status" : "alert"}
			className="flex items-center gap-2 text-xs text-muted-foreground"
		>
			<span className="flex-1">
				{loading ? (
					<Trans>Loading…</Trans>
				) : (
					<Trans>Unavailable on this host</Trans>
				)}
			</span>
			{!loading && (
				<JedvIconButton label={t({ message: "Retry" })} onClick={retry}>
					<LuRefreshCw className="size-3.5" />
				</JedvIconButton>
			)}
		</div>
	);
}
