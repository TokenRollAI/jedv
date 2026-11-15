import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Trans, useLingui } from "@lingui/react/macro";
import { UpdatesPill } from "renderer/components/UpdatesPill";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useSettings } from "renderer/stores/settings";
import { JedvReleaseNotes } from "../../../JedvReleaseNotes";
import { SettingRow } from "../SettingRow";

export function GeneralSettings() {
	const { t } = useLingui();
	const openUrl = electronTrpc.external.openUrl.useMutation();
	const changesTarget = useSettings((state) => state.changesOpenTarget);
	const updateSettings = useSettings((state) => state.update);
	const version = electronTrpc.autoUpdate.getVersionInfo.useQuery(undefined, {
		retry: false,
	});
	return (
		<div className="divide-y overflow-hidden rounded-lg border border-border">
			<SettingRow label={t({ message: "Open Changes in" })}>
				<Select
					value={changesTarget}
					onValueChange={(value) =>
						updateSettings(
							"changesOpenTarget",
							value === "tab" ? "tab" : "pane",
						)
					}
				>
					<SelectTrigger
						size="sm"
						className="w-40"
						aria-label={t({ message: "Open Changes in" })}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="pane">
							<Trans>Split pane</Trans>
						</SelectItem>
						<SelectItem value="tab">
							<Trans>New tab</Trans>
						</SelectItem>
					</SelectContent>
				</Select>
			</SettingRow>
			<SettingRow
				label="Jedv"
				description={t({ message: "Version installed on this device." })}
				error={version.error ? errorMessage(version.error) : undefined}
			>
				<span className="text-xs text-muted-foreground">
					{version.data ? (
						`v${version.data.currentVersion} · ${version.data.channel}`
					) : version.isPending ? (
						<Trans>Loading…</Trans>
					) : (
						<Button
							size="sm"
							variant="ghost"
							onClick={() => void version.refetch()}
						>
							<Trans>Retry</Trans>
						</Button>
					)}
				</span>
			</SettingRow>
			<SettingRow label={t({ message: "Updates" })}>
				<UpdatesPill variant="settings" />
			</SettingRow>
			<SettingRow label={t({ message: "Release notes" })}>
				<JedvReleaseNotes />
			</SettingRow>
			<SettingRow label={t({ message: "Open source acknowledgements" })}>
				<Button
					variant="link"
					size="sm"
					onClick={() =>
						openUrl.mutate(
							"https://github.com/TokenRollAI/jedv/blob/main/LICENSE.md",
						)
					}
				>
					<Trans>View license</Trans>
				</Button>
			</SettingRow>
		</div>
	);
}
