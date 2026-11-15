export const PERSISTED_KEY_REGISTRY: ReadonlyArray<
	readonly [file: string, keys: readonly string[]]
> = [
	["src/renderer/stores/getting-started/store.ts", ["pro-getting-started-v1"]],
	[
		"src/renderer/lib/terminal/terminal-runtime.ts",
		["terminal-buffer:*", "terminal-dims:*"],
	],
	["src/renderer/lib/terminal/terminal-seq-anchor.ts", ["terminal-seq:*"]],
	[
		"src/renderer/lib/terminal/terminal-buffer-gc.ts",
		["terminal-buffer-persisted-at"],
	],
	[
		"src/renderer/lib/trpc-storage.ts",
		["<store>:version", "<store>:pending", "<store>:pending:updatedAt"],
	],
	[
		"src/renderer/lib/persistent-hash-history/persistent-hash-history.ts",
		["router-history"],
	],
	["src/renderer/stores/changes/store.ts", ["changes-store"]],
	["src/renderer/stores/prompt-history.ts", ["prompt-history"]],
	[
		"src/renderer/stores/theme/store.ts",
		["theme-storage", "theme-terminal", "theme-id", "theme-type"],
	],
	["src/renderer/stores/ringtone/store.ts", ["ringtone-storage"]],
	["src/renderer/stores/settings.ts", ["settings"]],
	[
		"src/renderer/stores/markdown-preferences/store.ts",
		["markdown-preferences"],
	],
	["src/renderer/stores/ports/store.ts", ["ports-store"]],
	["src/renderer/stores/sidebar-state.ts", ["sidebar-store"]],
	[
		"src/renderer/stores/workspace-sidebar-state.ts",
		["workspace-sidebar-store"],
	],
	[
		"src/renderer/stores/sidebar-sections-collapse.ts",
		["sidebar-workspaces-collapse"],
	],
	[
		"src/renderer/stores/v2-workspace-create-defaults.ts",
		["v2-workspace-create-defaults"],
	],
	["src/renderer/stores/v2-project-local-meta.ts", ["v2-project-local-meta"]],
	["src/renderer/stores/v2-notifications/store.ts", ["v2-notifications-v1"]],
	["src/renderer/stores/hiring-banner/store.ts", ["hiring-banner-v1"]],
	[
		"src/renderer/stores/payment-failed-card-dismissal/store.ts",
		["payment-failed-card-dismissal-v1"],
	],
	["src/renderer/stores/star-nag/store.ts", ["star-nag-v1"]],
	[
		"src/renderer/stores/release-notes-card/store.ts",
		["release-notes-card-v1"],
	],
	[
		"src/renderer/stores/terminal-close-confirm/store.ts",
		["terminal-close-confirm-v1"],
	],
	[
		"src/renderer/stores/automation-failures/store.ts",
		["automation-failures-v1"],
	],
	[
		"src/renderer/stores/app-version-history/store.ts",
		["app-version-history-v1"],
	],
	[
		"src/renderer/stores/createDismissalsStore/createDismissalsStore.ts",
		[
			"desktop-notice-dismissals-v1",
			"v2-setup-card-dismissals-v1",
			"browser-import-banner-dismissals-v1",
		],
	],
	["src/renderer/stores/workspace-agents-row.ts", ["workspace-agents-row"]],
	["src/renderer/stores/chat-turn-snapshots.ts", ["chat-turn-snapshots"]],
	["src/renderer/stores/inline-workspace-ports.ts", ["inline-workspace-ports"]],
	["src/renderer/hotkeys/stores/hotkeyOverridesStore.ts", ["hotkey-overrides"]],
	[
		"src/renderer/hotkeys/stores/keyboardPreferencesStore.ts",
		["keyboard-preferences"],
	],
	[
		"src/renderer/hooks/useAgentModelPreference/useAgentModelPreference.ts",
		["lastSelectedV2WorkspaceCreateModelByPreset"],
	],
	[
		"src/renderer/hooks/useAgentEffortPreference/useAgentEffortPreference.ts",
		["lastSelectedV2WorkspaceCreateEffortByPreset"],
	],
	[
		"src/renderer/hooks/useAgentModePreference/useAgentModePreference.ts",
		["lastSelectedV2WorkspaceCreateModeByPreset"],
	],
	[
		"src/renderer/hooks/useAgentLaunchPreferences/useAgentLaunchPreferences.ts",
		[
			"lastSelectedV2WorkspaceCreateAgent",
			"lastOpenedInProjectId",
			"lastSelectedAgent",
			"agentAutoRun",
		],
	],
	[
		"src/renderer/hooks/useAgentSessionPlacement/useAgentSessionPlacement.ts",
		["lastSelectedDiffCommentPlacement"],
	],
];
