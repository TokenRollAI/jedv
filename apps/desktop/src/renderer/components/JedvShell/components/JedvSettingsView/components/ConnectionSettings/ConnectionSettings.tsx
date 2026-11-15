import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import type { JedvParityViewContext } from "../../../../parity-types";
import { SettingRow } from "../SettingRow";
export function ConnectionSettings(context: JedvParityViewContext) {
	const { t } = useLingui();
	const disconnect = useMutation({ mutationFn: context.onSelectLocalHost });
	return (
		<div className="rounded-lg border border-border overflow-hidden divide-y">
			<SettingRow
				label={t({ message: "Connected host" })}
				description={context.hostUrl}
			>
				<span className="text-xs text-muted-foreground">
					{context.remote
						? t({ message: "Private host" })
						: t({ message: "This device" })}
				</span>
			</SettingRow>
			<SettingRow
				label={t({ message: "Private connection" })}
				description={t({
					message:
						"Connect over Tailscale using the host's HTTPS address and PSK.",
				})}
				error={disconnect.error ? errorMessage(disconnect.error) : undefined}
			>
				<div className="flex gap-2">
					{context.remote && (
						<Button
							variant="outline"
							size="sm"
							disabled={disconnect.isPending}
							onClick={() => disconnect.mutate()}
						>
							<Trans>Use this device</Trans>
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={context.onOpenPrivateConnection}
					>
						<Trans>Connect to host</Trans>
					</Button>
				</div>
			</SettingRow>
		</div>
	);
}
