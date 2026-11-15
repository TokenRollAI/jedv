import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@jedv/i18n";
import { useLingui } from "@lingui/react/macro";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { AsyncSetting } from "../AsyncSetting";
export function LanguageSection() {
	const { t } = useLingui();
	return (
		<AsyncSetting
			id="language"
			label={t({ message: "Language" })}
			description={t({
				message: "App display language. Auto follows your system language.",
			})}
			read={async () =>
				(await electronTrpcClient.settings.getLanguage.query()) ?? "auto"
			}
			write={(language) =>
				electronTrpcClient.settings.setLanguage.mutate({
					language: language === "auto" ? null : language,
				})
			}
			options={[
				{ value: "auto", label: t({ message: "Auto (system)" }) },
				...SUPPORTED_LOCALES.map((value) => ({
					value,
					label: LOCALE_LABELS[value],
				})),
			]}
		/>
	);
}
