import { homedir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { startDaemonBootstrap } from "./daemon";
import { env } from "./env";
import { installConsoleTimestamps } from "./log-timestamps";
import { LocalGitCredentialProvider } from "./providers/git";
import { PskHostAuthProvider } from "./providers/host-auth";
import { provisionAgentIntegrations } from "./runtime/agent-provisioning";
import { processStartedAt, recordBootStamp } from "./runtime/boot-stamps";
import { resolveDesktopBridgeFromEnv } from "./runtime/desktop-bridge/env";
import { applyLoginShellEnvToProcess } from "./runtime/login-shell-env";
import { startVitalsLog } from "./runtime/vitals";
import { detachFromLaunchDirectory } from "./runtime/working-directory";
import { installProcessSafetyNet, installUpgradeSocketGuard } from "./safety";
import { startTerminalBaseEnvResolution } from "./terminal/env";
import { startTerminalReaper } from "./terminal/reaper";

async function main(): Promise<void> {
	process.env.JEDV_HOME_DIR ||= join(homedir(), ".jedv");
	installConsoleTimestamps();
	recordBootStamp("host.process.start", processStartedAt());
	detachFromLaunchDirectory();
	startTerminalBaseEnvResolution();
	void applyLoginShellEnvToProcess();
	await provisionAgentIntegrations();
	startDaemonBootstrap(env.ORGANIZATION_ID);

	const {
		app,
		injectWebSocket,
		db,
		dispose,
		recordUnfinishedChats,
		recoverWorkspaceSetupTerminals,
	} = createApp({
		config: {
			organizationId: env.ORGANIZATION_ID,
			dbPath: env.HOST_DB_PATH,
			migrationsFolder: env.HOST_MIGRATIONS_FOLDER,
			allowedOrigins: env.CORS_ORIGINS ?? ["null"],
			desktopBridge: resolveDesktopBridgeFromEnv(env),
		},
		providers: {
			hostAuth: new PskHostAuthProvider(env.HOST_SERVICE_SECRET),
			credentials: new LocalGitCredentialProvider(),
		},
	});

	const server = serve(
		{ fetch: app.fetch, port: env.PORT, hostname: "127.0.0.1" },
		(info) => {
			installProcessSafetyNet();
			console.log(`[jedv-host] listening on http://127.0.0.1:${info.port}`);
			recordBootStamp("host.listening");
			startTerminalReaper(db);
			void recoverWorkspaceSetupTerminals().catch((error) => {
				console.error("[jedv-host] Failed to recover setup observers:", error);
			});
			startVitalsLog();
		},
	);
	installUpgradeSocketGuard(server);
	injectWebSocket(server);

	let stopping = false;
	const stop = async () => {
		if (stopping) return;
		stopping = true;
		server.close();
		try {
			recordUnfinishedChats();
			await dispose();
		} finally {
			process.exit(0);
		}
	};
	process.once("SIGINT", () => void stop());
	process.once("SIGTERM", () => void stop());
}

void main().catch((error) => {
	console.error("[jedv-host] Failed to start:", error);
	process.exit(1);
});
