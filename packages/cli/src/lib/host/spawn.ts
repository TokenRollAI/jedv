import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { resolveAppHomeDir } from "@jedv/agent-setup/paths";
import { HOST_INSTALL_SOURCE_ENV } from "@jedv/shared/host-version";
import {
	MAX_HOST_LOG_BYTES,
	openRotatingLogFd,
} from "@jedv/shared/rotating-log";
import { LOCAL_HOST_NAMESPACE } from "../local";
import {
	ensureManifestDir,
	type HostServiceManifest,
	hostDbPath,
	hostServiceLogPath,
	writeManifest,
} from "./manifest";

const HEALTH_POLL_INTERVAL_MS = 200;
const HEALTH_POLL_TIMEOUT_MS = 10_000;

export interface SpawnHostOptions {
	port?: number;
	daemon: boolean;
}

export interface HostExit {
	code: number | null;
	signal: NodeJS.Signals | null;
}

export interface SpawnHostResult {
	pid: number;
	port: number;
	secret: string;
	exited: Promise<HostExit>;
}

export function describeHostExit(exit: HostExit): string {
	if (exit.signal) return `killed by ${exit.signal}`;
	return `exit code ${exit.code ?? "unknown"}`;
}

async function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") {
				const { port } = addr;
				server.close(() => resolve(port));
			} else {
				server.close(() => reject(new Error("Could not get port")));
			}
		});
		server.on("error", reject);
	});
}

async function pollHealth(port: number, secret: string): Promise<boolean> {
	const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 2_000);
			const res = await fetch(`http://127.0.0.1:${port}/trpc/health.check`, {
				signal: controller.signal,
				headers: { Authorization: `Bearer ${secret}` },
			});
			clearTimeout(timeout);
			if (res.ok) return true;
		} catch {
			// not ready
		}
		await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
	}
	return false;
}

/**
 * Resolve the sibling `jedv-host` wrapper binary.
 *
 * When running as a compiled binary, it's a sibling file in the same bin/
 * directory as the current executable. In dev (`bun run dev`), allow
 * override via JEDV_HOST_BIN env var.
 */
function resolveHostBinary(): string {
	if (process.env.JEDV_HOST_BIN) return process.env.JEDV_HOST_BIN;
	const cliBin = process.execPath;
	return join(dirname(cliBin), "jedv-host");
}

function resolveMigrationsFolder(): string {
	if (process.env.HOST_MIGRATIONS_FOLDER) {
		return process.env.HOST_MIGRATIONS_FOLDER;
	}
	// Compiled layout: <bundle>/bin/jedv → <bundle>/share/migrations
	const cliBin = process.execPath;
	const bundleRoot = dirname(dirname(cliBin));
	return join(bundleRoot, "share", "migrations");
}

export async function spawnHostService(
	options: SpawnHostOptions,
	spawnProcess: typeof spawn = spawn,
): Promise<SpawnHostResult> {
	const hostBin = resolveHostBinary();
	if (!existsSync(hostBin)) {
		throw new Error(
			`jedv-host binary not found at ${hostBin}. Set JEDV_HOST_BIN to override.`,
		);
	}

	const port = options.port ?? (await findFreePort());
	const secret = randomBytes(32).toString("hex");
	const migrationsFolder = resolveMigrationsFolder();

	if (options.daemon) ensureManifestDir(LOCAL_HOST_NAMESPACE);
	const logFd = options.daemon
		? openRotatingLogFd(
				hostServiceLogPath(LOCAL_HOST_NAMESPACE),
				MAX_HOST_LOG_BYTES,
			)
		: -1;
	const child = spawnProcess(hostBin, [], {
		stdio: options.daemon
			? logFd === -1
				? "ignore"
				: ["ignore", logFd, logFd]
			: "inherit",
		detached: options.daemon,
		env: {
			...process.env,
			ORGANIZATION_ID: LOCAL_HOST_NAMESPACE,
			AUTH_TOKEN: undefined,
			JEDV_API_KEY: undefined,
			JEDV_API_URL: undefined,
			JEDV_WEB_URL: undefined,
			JEDV_AUTH_CONFIG_PATH: undefined,
			RELAY_URL: undefined,
			REALTIME_URL: undefined,
			JEDV_SANDBOX_WORKSPACE_ID: undefined,
			JEDV_HOST_RUN_MODE: "local",
			PORT: String(port),
			HOST_SERVICE_PORT: String(port),
			HOST_SERVICE_SECRET: secret,
			HOST_DB_PATH: hostDbPath(LOCAL_HOST_NAMESPACE),
			HOST_MIGRATIONS_FOLDER: migrationsFolder,
			// A standalone install can replace itself in place (system.update);
			// the host-service reports this so clients offer the right action.
			[HOST_INSTALL_SOURCE_ENV]: "cli",
			JEDV_HOST_AUTO_UPDATE: "false",
			// The desktop injects this into hosts it spawns
			// (host-service-coordinator.ts); without it the host's PTYs get no
			// JEDV_HOME_DIR and every managed agent hook self-disables on
			// its own guard (#6254).
			JEDV_HOME_DIR: resolveAppHomeDir(),
		},
	});

	const exited = new Promise<HostExit>((resolve) => {
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});

	if (logFd !== -1) {
		try {
			closeSync(logFd);
		} catch {}
	}

	if (!child.pid) {
		throw new Error("Failed to spawn host-service");
	}

	const healthy = await pollHealth(port, secret);
	if (!healthy) {
		child.kill("SIGTERM");
		throw new Error(
			`Host service failed to start within ${HEALTH_POLL_TIMEOUT_MS}ms`,
		);
	}

	const manifest: HostServiceManifest = {
		pid: child.pid,
		endpoint: `http://127.0.0.1:${port}`,
		authToken: secret,
		startedAt: Date.now(),
		organizationId: LOCAL_HOST_NAMESPACE,
	};
	try {
		writeManifest(manifest);
	} catch (error) {
		child.kill("SIGTERM");
		throw error;
	}

	if (options.daemon) {
		child.unref();
	}

	return { pid: child.pid, port, secret, exited };
}
