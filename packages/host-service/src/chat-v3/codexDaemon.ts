import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	lstat,
	mkdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CodexNotification,
	CodexRpcClient,
	type CodexServerRequest,
	type CodexTransportHandlers,
	connectUnixCodexTransport,
} from "@jedv/chat-runtime";
import { TRPCError } from "@trpc/server";
import WebSocket from "ws";

export function nativeProfileHash(
	provider: string,
	env: NodeJS.ProcessEnv,
): string {
	const profile =
		provider === "codex"
			? (env.CODEX_HOME ?? join(homedir(), ".codex"))
			: provider === "claude"
				? (env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"))
				: provider === "kimi"
					? (env.KIMI_CODE_HOME ?? join(homedir(), ".kimi-code"))
					: (env.GEMINI_CLI_HOME ?? join(homedir(), ".gemini"));
	return createHash("sha256")
		.update(JSON.stringify([provider, profile]))
		.digest("hex")
		.slice(0, 20);
}

export type CodexDaemonInput = {
	workspaceId: string;
	cwd: string;
	command: string;
	env: NodeJS.ProcessEnv;
	args?: string[];
	configurationKey?: string;
};

export type SharedCodexDaemon = {
	profileHash: string;
	socketPath: string;
	client: CodexRpcClient;
	createTransport: (
		handlers: CodexTransportHandlers,
	) => ReturnType<typeof connectUnixCodexTransport>;
};

export function assertCodexDaemonConfiguration(
	active: string | undefined,
	incoming: string,
): void {
	if (active !== incoming)
		throw new TRPCError({
			code: "CONFLICT",
			message:
				"Codex shared daemon already uses another launch configuration for this workspace/profile. The existing daemon and native session were preserved; close it explicitly before changing service configuration.",
		});
}

export class CodexDaemonManager {
	private readonly daemons = new Map<string, Promise<SharedCodexDaemon>>();
	private readonly configurations = new Map<string, string>();

	constructor(
		private readonly events: {
			notification(
				workspaceId: string,
				profileHash: string,
				event: CodexNotification,
			): void;
			request(
				workspaceId: string,
				profileHash: string,
				event: CodexServerRequest,
			): void;
			exit(workspaceId: string, profileHash: string): void;
		},
		private readonly runDir = join(
			tmpdir(),
			`jedv-codex-${process.getuid?.() ?? "local"}`,
		),
	) {}

	ensure(input: CodexDaemonInput): Promise<SharedCodexDaemon> {
		const profileHash = nativeProfileHash("codex", input.env);
		const key = `${input.workspaceId}:${profileHash}`;
		const signature =
			input.configurationKey ??
			JSON.stringify([input.command, input.args ?? []]);
		const existing = this.daemons.get(key);
		if (existing) {
			assertCodexDaemonConfiguration(this.configurations.get(key), signature);
			return existing;
		}
		this.configurations.set(key, signature);
		const pending = this.connect(input, profileHash, () => {
			this.daemons.delete(key);
			this.configurations.delete(key);
		});
		this.daemons.set(key, pending);
		void pending.catch(() => {
			this.daemons.delete(key);
			this.configurations.delete(key);
		});
		return pending;
	}

	private async connect(
		input: CodexDaemonInput,
		profileHash: string,
		evict: () => void,
	): Promise<SharedCodexDaemon> {
		if (process.platform === "win32")
			throw new Error("Codex shared control requires Unix sockets");
		await mkdir(this.runDir, { recursive: true, mode: 0o700 });
		const dir = await lstat(this.runDir);
		if (!dir.isDirectory() || (process.getuid && dir.uid !== process.getuid()))
			throw new Error("Unsafe Codex run directory");
		await chmod(this.runDir, 0o700);
		const hash = createHash("sha256")
			.update(`${input.workspaceId}:${profileHash}`)
			.digest("hex")
			.slice(0, 24);
		const socketPath = join(this.runDir, `${hash}.sock`);
		let hasSocket = false;
		try {
			const socket = await lstat(socketPath);
			if (
				!socket.isSocket() ||
				(process.getuid && socket.uid !== process.getuid())
			)
				throw new Error("Unsafe Codex socket");
			hasSocket = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const createTransport = (handlers: CodexTransportHandlers) =>
			connectUnixCodexTransport(
				{ socketPath, createSocket: (url) => new WebSocket(url) },
				handlers,
			);
		const newClient = () =>
			new CodexRpcClient({
				createTransport,
				onNotification: (event) =>
					this.events.notification(input.workspaceId, profileHash, event),
				onServerRequest: (event) =>
					this.events.request(input.workspaceId, profileHash, event),
				onExit: () => {
					evict();
					this.events.exit(input.workspaceId, profileHash);
				},
			});
		const configurationPath = `${socketPath}.configuration`;
		const signature =
			input.configurationKey ??
			JSON.stringify([input.command, input.args ?? []]);
		if (hasSocket) {
			let recorded: string;
			try {
				const info = await lstat(configurationPath);
				if (!info.isFile() || (process.getuid && info.uid !== process.getuid()))
					throw new Error("Unsafe daemon configuration record");
				recorded = await readFile(configurationPath, "utf8");
			} catch (error) {
				throw new TRPCError({
					code: "CONFLICT",
					message:
						"The existing Codex daemon launch configuration cannot be verified. It was preserved; close it explicitly before reconnecting with this configuration.",
					cause: error,
				});
			}
			assertCodexDaemonConfiguration(recorded, signature);
			const client = newClient();
			try {
				await client.initialize();
				return { profileHash, socketPath, client, createTransport };
			} catch (error) {
				await client.close();
				throw error;
			}
		}
		let spawnError: Error | undefined;
		const child = spawn(
			input.command,
			[...(input.args ?? []), "app-server", "--listen", `unix://${socketPath}`],
			{
				cwd: input.cwd,
				env: input.env,
				detached: true,
				stdio: "ignore",
			},
		);
		child.once("error", (error) => {
			spawnError = error;
		});
		child.unref();
		const deadline = Date.now() + 3_000;
		while (true) {
			if (spawnError) throw spawnError;
			try {
				await lstat(socketPath);
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			if (Date.now() >= deadline)
				throw new Error("Codex app-server did not open its Unix socket");
			await new Promise((resolve) => setTimeout(resolve, 15));
		}
		await chmod(socketPath, 0o600);
		const pendingConfiguration = `${configurationPath}.${process.pid}.tmp`;
		try {
			await writeFile(pendingConfiguration, signature, {
				mode: 0o600,
				flag: "wx",
			});
			await rename(pendingConfiguration, configurationPath);
		} finally {
			await unlink(pendingConfiguration).catch((error) => {
				if (error.code !== "ENOENT")
					console.error("[codex-daemon] configuration cleanup failed", error);
			});
		}
		const client = newClient();
		try {
			await client.initialize();
			return { profileHash, socketPath, client, createTransport };
		} catch (error) {
			await client.close();
			throw error;
		}
	}
}
