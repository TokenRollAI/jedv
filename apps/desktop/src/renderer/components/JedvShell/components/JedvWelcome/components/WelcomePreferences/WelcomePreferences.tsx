import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@jedv/i18n";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFontSettingsMutation } from "renderer/hooks/useFontSettingsMutation";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { DEFAULT_TERMINAL_FONT_FAMILY } from "renderer/lib/terminal/appearance";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { FontFamilyCombobox } from "../../../JedvSettingsView/components/FontSettingSection/components/FontFamilyCombobox";
import { useSystemFonts } from "../../../JedvSettingsView/components/FontSettingSection/hooks/useSystemFonts";

export function WelcomePreferences() {
	const { t } = useLingui();
	const cache = useQueryClient();
	const languageKey = ["jedv-settings", "language"];
	const language = useQuery({
		queryKey: languageKey,
		queryFn: async () =>
			(await electronTrpcClient.settings.getLanguage.query()) ?? "auto",
		retry: false,
	});
	const saveLanguage = useMutation({
		mutationFn: (value: string) =>
			electronTrpcClient.settings.setLanguage.mutate({
				language: value === "auto" ? null : value,
			}),
		onSuccess: async () => {
			await cache.invalidateQueries({ queryKey: languageKey });
		},
	});
	const fonts = electronTrpc.settings.getFontSettings.useQuery(undefined, {
		retry: false,
	});
	const saveFonts = useFontSettingsMutation();
	const systemFonts = useSystemFonts();
	const failure =
		language.error ?? saveLanguage.error ?? fonts.error ?? saveFonts.error;
	return (
		<div className="rounded-lg border border-border bg-card/40">
			<div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
				<span className="text-xs font-medium">
					<Trans>Language</Trans>
				</span>
				<Select
					value={language.data ?? "auto"}
					disabled={
						language.isPending ||
						saveLanguage.isPending ||
						language.data === undefined
					}
					onValueChange={(value) => saveLanguage.mutate(value)}
				>
					<SelectTrigger
						size="sm"
						className="w-44"
						aria-label={t({ message: "Language" })}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="auto">
							<Trans>Auto (system)</Trans>
						</SelectItem>
						{SUPPORTED_LOCALES.map((locale) => (
							<SelectItem key={locale} value={locale}>
								{LOCALE_LABELS[locale]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3">
				<span className="text-xs font-medium">
					<Trans>Terminal font</Trans>
				</span>
				<div className="flex w-44 min-w-0">
					<FontFamilyCombobox
						value={fonts.data?.terminalFontFamily ?? null}
						defaultValue={DEFAULT_TERMINAL_FONT_FAMILY}
						variant="terminal"
						disabled={!fonts.data || saveFonts.isPending}
						onValueChange={(terminalFontFamily) =>
							saveFonts.mutate({ terminalFontFamily })
						}
						fonts={systemFonts.fonts}
						fontsLoading={systemFonts.isLoading}
					/>
				</div>
			</div>
			{failure && (
				<div role="alert" className="px-4 pb-3 text-xs text-destructive">
					<p>
						{errorMessage(
							failure,
							t({ message: "Could not save this setting. Try again." }),
						)}
					</p>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							if (saveLanguage.isError && saveLanguage.variables !== undefined)
								saveLanguage.mutate(saveLanguage.variables);
							else if (saveFonts.isError && saveFonts.variables)
								saveFonts.mutate(saveFonts.variables);
							else {
								void language.refetch();
								void fonts.refetch();
							}
						}}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
		</div>
	);
}
