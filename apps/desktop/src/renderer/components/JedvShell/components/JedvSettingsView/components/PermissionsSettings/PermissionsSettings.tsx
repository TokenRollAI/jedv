import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { SettingRow } from "../SettingRow";

export function PermissionsSettings() {
	const { t } = useLingui();
	const status = electronTrpc.permissions.getStatus.useQuery(undefined, {
		refetchOnWindowFocus: true,
	});
	const fullDisk = electronTrpc.permissions.requestFullDiskAccess.useMutation();
	const accessibility =
		electronTrpc.permissions.requestAccessibility.useMutation();

	const appleEvents = electronTrpc.permissions.requestAppleEvents.useMutation();
	const network = electronTrpc.permissions.requestLocalNetwork.useMutation();
	if (!navigator.userAgent.includes("Mac")) return null;
	const rows = [
		{
			label: t({ message: "Full Disk Access" }),
			granted: status.data?.fullDiskAccess,
			action: fullDisk,
		},
		{
			label: t({ message: "Accessibility" }),
			granted: status.data?.accessibility,
			action: accessibility,
		},

		{
			label: t({ message: "Automation (Apple Events)" }),
			granted: undefined,
			action: appleEvents,
		},
		{
			label: t({ message: "Local network" }),
			granted: undefined,
			action: network,
		},
	];
	return (
		<section className="space-y-3">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">
					<Trans>System permissions</Trans>
				</h3>
				<Button
					size="sm"
					variant="ghost"
					disabled={status.isFetching}
					onClick={() => void status.refetch()}
				>
					<Trans>Refresh</Trans>
				</Button>
			</div>
			{status.error && (
				<p role="alert" className="text-xs text-destructive">
					{errorMessage(status.error)}
				</p>
			)}
			<div className="divide-y overflow-hidden rounded-lg border border-border">
				{rows.map(({ label, granted, action }) => (
					<SettingRow
						key={label}
						label={label}
						description={
							granted === undefined
								? t({
										message:
											"Status unavailable. Review this permission in System Settings.",
									})
								: undefined
						}
						error={action.error ? errorMessage(action.error) : undefined}
					>
						<div className="flex flex-wrap items-center justify-end gap-2">
							<span className="text-xs text-muted-foreground">
								{granted === true ? (
									<Trans>Granted</Trans>
								) : granted === false ? (
									<Trans>Not granted</Trans>
								) : (
									<Trans>Unknown</Trans>
								)}
							</span>
							<Button
								variant="outline"
								size="sm"
								disabled={action.isPending}
								onClick={() => action.mutate()}
							>
								<Trans>Open System Settings</Trans>
							</Button>
						</div>
					</SettingRow>
				))}
			</div>
		</section>
	);
}
