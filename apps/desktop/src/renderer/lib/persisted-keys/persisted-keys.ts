interface DeadKey {
	key: string;
	match: "exact" | "prefix";
}

/**
 * Keys no current code reads or writes. Swept at boot; when removing a
 * feature that persisted state, move its keys here instead of just deleting
 * the writer.
 */
export const DEAD_KEYS: DeadKey[] = [
	{ key: "__ph_opt_in_out_", match: "prefix" },
	{ key: "active_organization_id", match: "exact" },
	{ key: "channel-panels-v1", match: "exact" },
	{ key: "channels-emoji-skin-tone", match: "exact" },
	{ key: "chat-tabs", match: "exact" },
	{ key: "chat-v3-draft:", match: "prefix" },
	{ key: "chatFavoriteModels", match: "exact" },
	{ key: "chatLastAgent", match: "exact" },
	{ key: "chatModeByAgent", match: "exact" },
	{ key: "cloud-sidebar", match: "exact" },
	{ key: "daemon-update-dismissed-failure-", match: "prefix" },
	{ key: "failed-workspace-creates-", match: "prefix" },
	{ key: "jedv-navigation-v1", match: "exact" },
	{ key: "lastSelectedDiffCommentNewAgentConfigId", match: "exact" },
	{ key: "lastSelectedV2IssueBatchAgent", match: "exact" },
	{ key: "lastSelectedV2TaskBatchAgent", match: "exact" },
	{ key: "lastViewedWorkspaceId", match: "exact" },
	{ key: "leaderboard-auto-publish-v2", match: "exact" },
	{ key: "leaderboard-card-collapsed-v1", match: "exact" },
	{ key: "list-display", match: "exact" },
	{ key: "pending-chat-stops-v1", match: "exact" },
	{ key: "ph_", match: "prefix" },
	{ key: "pull-requests-filter-state", match: "exact" },
	{ key: "pull-requests-split-view-state", match: "exact" },
	{ key: "jedv-last-auth-method", match: "exact" },
	{ key: "jedv.terminalRichInputOpen", match: "exact" },
	{ key: "jedv:dev:v2-sidebar-seeded", match: "exact" },
	{ key: "tabs-storage", match: "exact" },
	{ key: "tasks-filter-state", match: "exact" },
	{ key: "usage-last-section-v1", match: "exact" },
	{ key: "v1-migration-attention-dismissed-", match: "prefix" },
	{ key: "v1-migration-complete-", match: "prefix" },
	{ key: "v1-migration-continuity-pending-", match: "prefix" },
	{ key: "v1-migration-followup-pending-", match: "prefix" },
	{ key: "v1-migration-welcome-pending-", match: "prefix" },
	{ key: "v1-terminals-notice-", match: "prefix" },
	{ key: "v2-changes-sections-v1", match: "exact" },
	{ key: "v2-pane-scroll-state-v1", match: "exact" },
	{ key: "v2-sidebar-projects-", match: "prefix" },
	{ key: "v2-sidebar-sections-", match: "prefix" },
	{ key: "v2-terminal-presets-", match: "prefix" },
	{ key: "v2-user-preferences-", match: "prefix" },
	{ key: "v2-workspace-local-state-", match: "prefix" },
	{ key: "v2-workspaces-view", match: "exact" },
	// New workspace composer width; the resize handles were removed
	{ key: "new-workspace-width", match: "exact" },
	// Device-local Chat setting; moved to the account (user_settings.experimental_chat)
	{ key: "acp-chat", match: "exact" },
	// The task page's inline agent picker; Start work opens New Workspace instead
	{ key: "lastSelectedV2TaskAgent", match: "exact" },
	{ key: "getting-started-v1", match: "exact" },
	// Pending-create records; superseded by canonical workspaces.create (#3893)
	{ key: "pending-workspaces-", match: "prefix" },
	// v1→v2 preset migration marker; superseded by pull-based importer (#4122)
	{ key: "v2-terminal-presets-migrated-", match: "prefix" },
	// Replaced by v2-notifications-v1
	{ key: "notification-center-store", match: "exact" },
	// Right pane area opt-out; the right pane area is on for everyone
	{ key: "right-pane-area", match: "exact" },
	// Workspace details moved into the workspace item (#5392)
	{ key: "workspace-details-store", match: "exact" },
	// Replaced by the v2 onboarding setup flow (#4080)
	{ key: "jedv-onboarding-v1", match: "exact" },
	// Analytics funnel marker removed in #502-era simplification
	{ key: "jedv_auth_completed", match: "exact" },
	// One-shot hotkey migration marker; migration removed (#3391)
	{ key: "hotkey-overrides-migrated-v2", match: "exact" },
	// Unattributed analytics remnants; no writer remains in repo or dependencies
	{ key: "outlit_", match: "prefix" },
	// Superseded by v2-workspace-local-state.sidebarState; store deleted in
	// SUPER-1686 after the audit found no consumers
	{ key: "v2-workspace-local-meta", match: "exact" },
	// Section metadata store had no consumers; writer removed in SUPER-1686
	{ key: "v2-section-local-meta", match: "exact" },
	// v1→v2 migration ledger markers; superseded by the importer ledger
	{ key: "v1-migration-last-run-at-", match: "prefix" },
	{ key: "v1-migration-modal-shown-", match: "prefix" },
	// Legacy chat composer preferences; the mastra chat panes were removed
	{ key: "chat-preferences", match: "exact" },
	// "Jedv v2 is here" sidebar card; unmounted once v2 became the default
	{ key: "v2-available-banner-v1", match: "exact" },
	// Bumped to v2 so updated clients republish a full 30-day leaderboard window
	{ key: "leaderboard-auto-publish-v1", match: "exact" },
	// Launch-time "join the leaderboard" prompt removed; joining lives in settings
	{ key: "leaderboard-asked-v1", match: "exact" },
	// Opening a page no longer routes to the last-visited workspace
	{ key: "last-active-v2-workspace", match: "exact" },
	// v1/v2 surface toggle; v2 is always on
	{ key: "v2-local-override-v2", match: "exact" },
	// New-sidebar experiment toggle; the new sidebar is always on
	{ key: "new-dashboard-sidebar", match: "exact" },
	// File explorer and search dialog zustand stores had no consumers
	{ key: "file-explorer-store", match: "exact" },
	{ key: "search-dialog-store", match: "exact" },
];

function matchesDeadKey(key: string): boolean {
	return DEAD_KEYS.some((dead) =>
		dead.match === "exact" ? key === dead.key : key.startsWith(dead.key),
	);
}

/**
 * Run once at renderer boot. Removes keys from features that no longer
 * exist; returns the number of keys removed.
 */
export function sweepDeadPersistedKeys(storage?: Storage): number {
	try {
		const resolvedStorage = storage ?? localStorage;
		const doomed: string[] = [];
		for (let i = 0; i < resolvedStorage.length; i++) {
			const key = resolvedStorage.key(i);
			if (key && matchesDeadKey(key)) doomed.push(key);
		}
		for (const key of doomed) resolvedStorage.removeItem(key);
		return doomed.length;
	} catch (error) {
		console.warn("[persisted-keys] Dead-key sweep failed", error);
		return 0;
	}
}
