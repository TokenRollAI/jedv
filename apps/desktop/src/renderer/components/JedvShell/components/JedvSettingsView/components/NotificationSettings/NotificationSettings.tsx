import { errorMessage } from "@jedv/i18n/errors";
import { RINGTONES } from "@jedv/shared/ringtones";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { AsyncSetting } from "../AsyncSetting";
import { SettingRow } from "../SettingRow";
export function NotificationSettings() {
	const { t } = useLingui();
	const cache = useQueryClient();
	const custom = useQuery({
		queryKey: ["jedv-settings", "custom-ringtone"],
		queryFn: () => electronTrpcClient.ringtone.getCustom.query(),
	});
	const preview = useMutation({
		mutationFn: async () => {
			const [ringtoneId, volume] = await Promise.all([
				electronTrpcClient.settings.getSelectedRingtoneId.query(),
				electronTrpcClient.settings.getNotificationVolume.query(),
			]);
			return electronTrpcClient.ringtone.playNotification.mutate({
				ringtoneId,
				volume,
			});
		},
	});
	const importSound = useMutation({
		mutationFn: async () => {
			const result = await electronTrpcClient.ringtone.importCustom.mutate();
			if (!result.canceled)
				await electronTrpcClient.settings.setSelectedRingtoneId.mutate({
					ringtoneId: "custom",
				});
			return result;
		},
		onSuccess: () => cache.invalidateQueries({ queryKey: ["jedv-settings"] }),
	});
	return (
		<div className="rounded-lg border border-border overflow-hidden divide-y">
			<AsyncSetting
				id="sounds-muted"
				label={t({ message: "Mute notification sounds" })}
				description={t({
					message: "Keep notifications silent on this device.",
				})}
				read={() =>
					electronTrpcClient.settings.getNotificationSoundsMuted.query()
				}
				write={(muted) =>
					electronTrpcClient.settings.setNotificationSoundsMuted.mutate({
						muted,
					})
				}
			/>
			<AsyncSetting
				id="notification-volume"
				label={t({ message: "Volume" })}
				description={t({ message: "Notification sound volume from 0 to 100." })}
				min={0}
				max={100}
				step={1}
				read={() => electronTrpcClient.settings.getNotificationVolume.query()}
				write={(volume) =>
					electronTrpcClient.settings.setNotificationVolume.mutate({ volume })
				}
			/>
			<AsyncSetting
				id="ringtone"
				label={t({ message: "Notification sound" })}
				read={() => electronTrpcClient.settings.getSelectedRingtoneId.query()}
				write={(ringtoneId) =>
					electronTrpcClient.settings.setSelectedRingtoneId.mutate({
						ringtoneId,
					})
				}
				options={[
					...RINGTONES.map((ringtone) => ({
						value: ringtone.id,
						label: ringtone.name,
					})),
					...(custom.data
						? [{ value: "custom", label: t({ message: "Custom sound" }) }]
						: []),
				]}
			/>
			<SettingRow
				label={t({ message: "Custom notification sound" })}
				description={t({
					message: "Import an audio file or preview the selected sound.",
				})}
				error={
					preview.error || importSound.error
						? errorMessage(preview.error ?? importSound.error)
						: undefined
				}
			>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={preview.isPending}
						onClick={() => preview.mutate()}
					>
						<Trans>Preview</Trans>
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={importSound.isPending}
						onClick={() => importSound.mutate()}
					>
						<Trans>Import sound</Trans>
					</Button>
				</div>
			</SettingRow>
		</div>
	);
}
