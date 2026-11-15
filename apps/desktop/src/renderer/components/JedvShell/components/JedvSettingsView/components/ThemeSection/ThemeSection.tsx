import { errorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import { toast } from "@jedv/ui/sonner";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { type ChangeEvent, useRef, useState } from "react";
import { HiOutlineArrowDownTray, HiOutlineArrowUpTray } from "react-icons/hi2";
import { HighlightText } from "renderer/components/JedvShell/components/JedvSettingsView/components/HighlightText";
import { useSettingsSearchQuery } from "renderer/components/JedvShell/components/JedvSettingsView/hooks/useSettingsSearch";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	SYSTEM_THEME_ID,
	useSystemDarkThemeId,
	useSystemLightThemeId,
	useThemeId,
	useThemeStore,
} from "renderer/stores/theme";
import {
	builtInThemes,
	darkTheme as defaultDarkTheme,
	lightTheme as defaultLightTheme,
	getTerminalColors,
	parseThemeConfigFile,
	type Theme,
} from "shared/themes";
import { ThemeRow } from "./components/ThemeRow/ThemeRow";

const MAX_THEME_FILE_SIZE = 256 * 1024;

export function ThemeSection() {
	const { t } = useLingui();
	const searchQuery = useSettingsSearchQuery();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isImporting, setIsImporting] = useState(false);
	const activeThemeId = useThemeId();
	const activeTheme = useThemeStore((state) => state.activeTheme);
	const customThemes = useThemeStore((state) => state.customThemes);
	const upsertCustomThemes = useThemeStore((state) => state.upsertCustomThemes);
	const systemLightThemeId = useSystemLightThemeId();
	const systemDarkThemeId = useSystemDarkThemeId();
	const saveTheme = useMutation({
		mutationFn: async (patch: {
			activeThemeId?: string;
			systemLightThemeId?: string;
			systemDarkThemeId?: string;
		}) => {
			const state = useThemeStore.getState();
			const next = {
				activeThemeId: state.activeThemeId,
				customThemes: state.customThemes.map((theme) => ({
					...theme,
					terminal: getTerminalColors(theme),
				})),
				systemLightThemeId: state.systemLightThemeId,
				systemDarkThemeId: state.systemDarkThemeId,
				...patch,
			};
			await electronTrpcClient.uiState.theme.set.mutate(next);
			state.applyExternalThemeState(next);
		},
	});
	const setTheme = (activeThemeId: string) =>
		saveTheme.mutate({ activeThemeId });
	const setSystemThemePreference = (mode: "light" | "dark", id: string) =>
		saveTheme.mutate(
			mode === "light" ? { systemLightThemeId: id } : { systemDarkThemeId: id },
		);

	const allThemes = [...builtInThemes, ...customThemes];
	const lightThemes = allThemes.filter((t) => t.type === "light");
	const darkThemes = allThemes.filter((t) => t.type === "dark");
	const builtInLightThemes = lightThemes.filter((t) => !t.isCustom);
	const builtInDarkThemes = darkThemes.filter((t) => !t.isCustom);
	const customLightThemes = lightThemes.filter((t) => t.isCustom);
	const customDarkThemes = darkThemes.filter((t) => t.isCustom);

	const lightGroupLabel = t({
		message: "Light",
	});
	const darkGroupLabel = t({
		message: "Dark",
	});
	const customGroupLabel = t({
		message: "Custom",
	});

	const allOptions: ReadonlyArray<{ group: string; themes: Theme[] }> = [
		{ group: lightGroupLabel, themes: builtInLightThemes },
		{ group: darkGroupLabel, themes: builtInDarkThemes },
		...(customThemes.length > 0
			? [
					{
						group: customGroupLabel,
						themes: [...customLightThemes, ...customDarkThemes],
					},
				]
			: []),
	];
	const lightOptions: ReadonlyArray<{ group: string; themes: Theme[] }> =
		customLightThemes.length > 0
			? [
					{ group: lightGroupLabel, themes: builtInLightThemes },
					{ group: customGroupLabel, themes: customLightThemes },
				]
			: [{ group: lightGroupLabel, themes: builtInLightThemes }];
	const darkOptions: ReadonlyArray<{ group: string; themes: Theme[] }> =
		customDarkThemes.length > 0
			? [
					{ group: darkGroupLabel, themes: builtInDarkThemes },
					{ group: customGroupLabel, themes: customDarkThemes },
				]
			: [{ group: darkGroupLabel, themes: builtInDarkThemes }];

	const systemLightTheme =
		allThemes.find((t) => t.id === systemLightThemeId) ??
		builtInThemes.find((t) => t.id === "light") ??
		defaultLightTheme;
	const systemDarkTheme =
		allThemes.find((t) => t.id === systemDarkThemeId) ??
		builtInThemes.find((t) => t.id === "dark") ??
		defaultDarkTheme;

	const isSystemMode = activeThemeId === SYSTEM_THEME_ID;
	const currentTheme =
		allThemes.find((t) => t.id === activeThemeId) ?? systemDarkTheme;

	const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		if (file.size > MAX_THEME_FILE_SIZE) {
			toast.error(
				t({
					message: "Theme file too large",
				}),
				{
					description: t({
						message: "Maximum size is 256 KB.",
					}),
				},
			);
			return;
		}

		setIsImporting(true);
		const stateBeforeImport = useThemeStore.getState();
		const previous = {
			activeThemeId: stateBeforeImport.activeThemeId,
			customThemes: stateBeforeImport.customThemes,
			systemLightThemeId: stateBeforeImport.systemLightThemeId,
			systemDarkThemeId: stateBeforeImport.systemDarkThemeId,
		};
		try {
			const content = await file.text();
			const parsed = parseThemeConfigFile(content);

			if (!parsed.ok) {
				toast.error(
					t({
						message: "Failed to import theme file",
					}),
					{
						description: parsed.error,
					},
				);
				return;
			}

			const summary = upsertCustomThemes(parsed.themes);
			const totalImported = summary.added + summary.updated;

			if (totalImported === 0) {
				toast.error(
					t({
						message: "No themes were imported",
					}),
					{
						description:
							summary.skipped > 0
								? t({
										message:
											"All themes used reserved IDs (built-in or system).",
									})
								: t({
										message: "The file did not contain any importable themes.",
									}),
					},
				);
				return;
			}

			await saveTheme.mutateAsync({});
			toast.success(
				t({
					message: plural(totalImported, {
						one: "Imported # custom theme",
						other: "Imported # custom themes",
					}),
				}),
				{
					description:
						summary.updated > 0
							? t({
									message: plural(summary.updated, {
										one: "# existing theme updated",
										other: "# existing themes updated",
									}),
								})
							: undefined,
				},
			);

			if (parsed.issues.length > 0) {
				toast.warning(
					t({
						message: "Some themes were skipped",
					}),
					{
						description: parsed.issues[0],
					},
				);
			}
		} catch (error) {
			useThemeStore.getState().applyExternalThemeState(previous);
			toast.error(
				t({
					message: "Failed to import theme file",
				}),
				{
					description: errorMessage(
						error,
						t({
							message: "Unable to read file",
						}),
					),
				},
			);
		} finally {
			setIsImporting(false);
		}
	};

	const handleExportTheme = () => {
		if (!activeTheme) return;
		const blob = new Blob(
			[
				JSON.stringify(
					{ ...activeTheme, terminal: getTerminalColors(activeTheme) },
					null,
					2,
				),
			],
			{ type: "application/json" },
		);
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${activeTheme.id}.json`;
		link.click();
		URL.revokeObjectURL(url);
	};
	const handleDownloadBaseTheme = () => {
		const baseTheme = activeTheme ?? builtInThemes[0];
		if (!baseTheme) return;

		const baseConfig = {
			id: "my-custom-theme",
			name: "My Custom Theme",
			type: baseTheme.type,
			author: "You",
			description: "Custom Jedv theme",
			ui: baseTheme.ui,
			terminal: getTerminalColors(baseTheme),
		};

		const blob = new Blob([JSON.stringify(baseConfig, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = "jedv-theme-base.json";
		link.click();
		URL.revokeObjectURL(url);
	};

	return (
		<>
			{saveTheme.error && (
				<p role="alert" className="p-4 text-xs text-destructive">
					{errorMessage(
						saveTheme.error,
						t({ message: "Could not save the theme. Try again." }),
					)}
				</p>
			)}
			<ThemeRow
				disabled={isImporting || saveTheme.isPending}
				label={t({
					message: "Theme",
				})}
				hint={<Trans>Pick a theme or follow your system appearance.</Trans>}
				value={activeThemeId}
				onValueChange={setTheme}
				currentTheme={currentTheme}
				options={allOptions}
				includeSystem={{
					darkTheme: systemDarkTheme,
					lightTheme: systemLightTheme,
				}}
			/>
			{isSystemMode && (
				<>
					<ThemeRow
						disabled={isImporting || saveTheme.isPending}
						label={t({
							message: "Light theme",
						})}
						hint={t({
							message: "Used when your system is in light mode.",
						})}
						value={systemLightThemeId}
						onValueChange={(id) => setSystemThemePreference("light", id)}
						currentTheme={systemLightTheme}
						options={lightOptions}
					/>
					<ThemeRow
						disabled={isImporting || saveTheme.isPending}
						label={t({
							message: "Dark theme",
						})}
						hint={t({
							message: "Used when your system is in dark mode.",
						})}
						value={systemDarkThemeId}
						onValueChange={(id) => setSystemThemePreference("dark", id)}
						currentTheme={systemDarkTheme}
						options={darkOptions}
					/>
				</>
			)}
			<div className="flex items-center justify-between gap-6 p-4">
				<div className="min-w-0 flex-1">
					<div className="text-sm font-medium">
						<HighlightText
							text={t({
								message: "Custom themes",
							})}
							query={searchQuery}
						/>
					</div>
					<div className="text-xs text-muted-foreground">
						<HighlightText
							text={t({
								message: "Import a theme file or grab a starter to edit.",
							})}
							query={searchQuery}
						/>
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleExportTheme}
						disabled={!activeTheme || saveTheme.isPending}
					>
						<Trans>Export theme</Trans>
					</Button>
					<input
						ref={fileInputRef}
						type="file"
						accept=".json,application/json"
						className="hidden"
						onChange={handleImport}
					/>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleDownloadBaseTheme}
					>
						<HiOutlineArrowDownTray className="mr-1.5 h-4 w-4" />
						<Trans>Download starter</Trans>
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => fileInputRef.current?.click()}
						disabled={isImporting || saveTheme.isPending}
					>
						<HiOutlineArrowUpTray className="mr-1.5 h-4 w-4" />
						{isImporting ? <Trans>Importing...</Trans> : <Trans>Import</Trans>}
					</Button>
				</div>
			</div>
		</>
	);
}
