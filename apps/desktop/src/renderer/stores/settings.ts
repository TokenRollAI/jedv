import {
	DEFAULT_LINK_SETTINGS,
	healLinkSettings,
} from "renderer/components/JedvShell/components/JedvFilesView/utils/link-policy/settings";
import type { LinkSettings } from "renderer/components/JedvShell/components/JedvFilesView/utils/link-policy/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChangesOpenTarget = "pane" | "tab";

interface Settings extends LinkSettings {
	diffStyle: "split" | "unified";
	showDiffComments: boolean;
	expandUnchanged: boolean;
	/** How the top-bar Changes button (and ⌘⇧G) opens the Changes surface:
	 * split the current tab, or focus/create a dedicated tab. */
	changesOpenTarget: ChangesOpenTarget;
	showJedvAnywhereButton: boolean;
}

interface SettingsStore extends Settings {
	update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export const useSettings = create<SettingsStore>()(
	persist(
		(set) => ({
			...healLinkSettings(DEFAULT_LINK_SETTINGS),
			diffStyle: "split",
			showDiffComments: true,
			expandUnchanged: false,
			changesOpenTarget: "pane",
			showJedvAnywhereButton: true,
			update: (key, value) =>
				set(
					key in DEFAULT_LINK_SETTINGS
						? {
								[key]: healLinkSettings({ [key]: value })[
									key as keyof LinkSettings
								],
							}
						: { [key]: value },
				),
		}),
		{
			name: "settings",
			merge: (persisted, current) => ({
				...current,
				...(persisted && typeof persisted === "object" ? persisted : {}),
				...healLinkSettings(persisted),
				update: current.update,
			}),
		},
	),
);
