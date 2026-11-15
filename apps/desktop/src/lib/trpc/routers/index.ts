import type { BrowserWindow } from "electron";
import { router } from "..";
import { createAgentIslandRouter } from "./agent-island";
import { createAttachmentsRouter } from "./attachments";
import { createAutoUpdateRouter } from "./auto-update";

import { createChangesRouter } from "./changes";
import { createConfigRouter } from "./config";

import { createExternalRouter } from "./external";
import { createFilesystemRouter } from "./filesystem";
import { createHostServiceCoordinatorRouter } from "./host-service-coordinator";
import { createKeyboardLayoutRouter } from "./keyboardLayout";
import { createMenuRouter } from "./menu";
import { createNotificationsRouter } from "./notifications";
import { createPaneLayoutRouter } from "./pane-layout/pane-layout";
import { createPermissionsRouter } from "./permissions";
import { createPortForwardsRouter } from "./port-forwards";
import { createPortsRouter } from "./ports";
import { createResourceMetricsRouter } from "./resource-metrics";
import { createRingtoneRouter } from "./ringtone";
import { createScreenshotsRouter } from "./screenshots";
import { createSettingsRouter } from "./settings";
import { createSystemRouter } from "./system";
import { createUiStateRouter } from "./ui-state";
import { createWindowRouter } from "./window";

export const createAppRouter = (getWindow: () => BrowserWindow | null) => {
	return router({
		agentIsland: createAgentIslandRouter(),
		autoUpdate: createAutoUpdateRouter(),
		attachments: createAttachmentsRouter(),

		screenshots: createScreenshotsRouter(),
		window: createWindowRouter(),
		changes: createChangesRouter(),
		filesystem: createFilesystemRouter(),
		notifications: createNotificationsRouter(getWindow),
		paneLayout: createPaneLayoutRouter(),
		permissions: createPermissionsRouter(),
		ports: createPortsRouter(),
		portForwards: createPortForwardsRouter(),
		resourceMetrics: createResourceMetricsRouter(),
		menu: createMenuRouter(),
		external: createExternalRouter(),
		settings: createSettingsRouter(),
		system: createSystemRouter(),
		config: createConfigRouter(),
		uiState: createUiStateRouter(),
		ringtone: createRingtoneRouter(getWindow),
		hostServiceCoordinator: createHostServiceCoordinatorRouter(),
		keyboardLayout: createKeyboardLayoutRouter(),
	});
};

export type AppRouter = ReturnType<typeof createAppRouter>;
