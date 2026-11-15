import { strict as assert } from "node:assert";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { watch } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { Server } from "@jedv/pty-daemon";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { eq } from "drizzle-orm";
import SuperJSON from "superjson";
import type { CreateAppResult } from "../app";
import {
	hostAgentConfigs,
	mailDeliveries,
	projects,
	teamMembers,
	terminalSessions,
	workspaceSetup,
	workspaces,
} from "../db/schema";
import type { AppRouter } from "../trpc/router";

const run = promisify(execFile);
const root = mkdtempSync(join(tmpdir(), "jedv-teamwork-m1-"));
const appHome = join(root, "app"),
	userHome = join(root, "user"),
	logs = join(root, "records");
const socketPath = join(tmpdir(), `jedv-teamwork-m1-${process.pid}.sock`);
const cliBin = resolve(import.meta.dirname, "../../../cli/dist/jedv");
const realCodexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
const psk = randomUUID();
const workspaceId = randomUUID(),
	otherWorkspaceId = randomUUID(),
	projectId = randomUUID(),
	otherProjectId = randomUUID();
let host: CreateAppResult;
let http: ReturnType<typeof serve>;
let endpoint: string;
let client: ReturnType<typeof createTRPCClient<AppRouter>>;
let daemon: Server;
let terminal: typeof import("../terminal/terminal");
let daemonClient: typeof import("../terminal/daemon-client-singleton");
let teamId: string, leaderTerminalId: string;
type BuiltHostFixture = {
	createApp: typeof import("../app")["createApp"];
	terminal: typeof import("../terminal/terminal");
	daemonClient: typeof import("../terminal/daemon-client-singleton");
	initTerminalBaseEnv: typeof import("../terminal/env")["initTerminalBaseEnv"];
	__setAccountShellForTesting: typeof import("../terminal/user-shell")["__setAccountShellForTesting"];
};
let builtHost: BuiltHostFixture;

async function record<T = Record<string, unknown>>(name: string): Promise<T> {
	const path = join(logs, name);
	const iterator = watch(logs, { signal: AbortSignal.timeout(30_000) });
	try {
		if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
		for await (const _event of iterator) {
			const errorFile = join(logs, `${name.split(".")[0]}.error.json`);
			if (existsSync(errorFile))
				throw new Error(readFileSync(errorFile, "utf8"));
			if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T;
		}
		throw new Error(`Missing fixture record: ${name}`);
	} catch (error) {
		if (leaderTerminalId && host) {
			const screen = await terminal.snapshotSession({
				terminalId: leaderTerminalId,
				workspaceId,
				db: host.db,
				maxLines: 80,
			});
			console.error("[teamwork-fixture] leader screen", screen);
		}
		throw error;
	} finally {
		await iterator.return?.();
	}
}
async function cli(
	args: string[],
	actor?: { workspaceId: string; terminalId: string },
) {
	const { stdout } = await run(cliBin, [...args, "--json"], {
		env: {
			...process.env,
			JEDV_HOME_DIR: appHome,
			JEDV_USER_HOME_DIR: userHome,
			JEDV_TEAM_ID: "",
			JEDV_TEAM_MEMBER_ID: "",
			JEDV_WORKSPACE_ID: actor?.workspaceId ?? "",
			JEDV_TERMINAL_ID: actor?.terminalId ?? "",
			JEDV_AGENT_LAUNCH_ID: actor
				? (host.terminalAgentStore.get(actor.terminalId)?.launchId ?? "")
				: "",
			CI: "1",
		},
		maxBuffer: 4 * 1024 * 1024,
	});
	return JSON.parse(stdout);
}
async function boot() {
	const { createApp } = builtHost;
	const { PskHostAuthProvider } = await import("../providers/host-auth");
	host = createApp({
		config: {
			organizationId: "jedv-local",
			dbPath: join(appHome, "host.db"),
			migrationsFolder: resolve(import.meta.dirname, "../../drizzle"),
			allowedOrigins: [],
		},
		providers: {
			hostAuth: new PskHostAuthProvider(psk),
			credentials: {
				getCredentials: async () => ({
					env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
				}),
				getToken: async () => null,
				credentialRemedy: () => "No external credentials in fixture",
			},
		},
	});
	http = serve({ fetch: host.app.fetch, hostname: "127.0.0.1", port: 0 });
	host.injectWebSocket(http);
	if (!http.listening)
		await new Promise<void>((resolveReady) =>
			http.once("listening", resolveReady),
		);
	const address = http.address();
	assert.ok(address && typeof address !== "string");
	endpoint = `http://127.0.0.1:${address.port}`;
	process.env.HOST_SERVICE_PORT = String(address.port);
	const manifestDir = join(appHome, "host/jedv-local");
	mkdirSync(manifestDir, { recursive: true });
	writeFileSync(
		join(manifestDir, "manifest.json"),
		JSON.stringify({
			pid: process.pid,
			endpoint,
			authToken: psk,
			startedAt: Date.now(),
			organizationId: "jedv-local",
		}),
		{ mode: 0o600 },
	);
	client = createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${endpoint}/trpc`,
				transformer: SuperJSON,
				headers: { Authorization: `Bearer ${psk}` },
			}),
		],
	});
	await client.team.capabilities.query();
}
async function closeHost() {
	terminal.__resetSessionsForTesting();
	await daemonClient.disposeDaemonClient();
	await host.dispose();
	if ("closeAllConnections" in http) http.closeAllConnections();
	await new Promise<void>((resolveClosed) => http.close(() => resolveClosed()));
}

before(async () => {
	assert.ok(
		existsSync(cliBin),
		"Build packages/cli before running the M1 PTY fixture",
	);
	for (const directory of [appHome, userHome, logs])
		mkdirSync(directory, { recursive: true });
	process.env.JEDV_HOME_DIR = appHome;
	process.env.JEDV_USER_HOME_DIR = userHome;
	process.env.JEDV_PTY_DAEMON_SOCKET = socketPath;
	process.env.HOST_SERVICE_VERSION = "0.0.0-teamwork-fixture";
	process.env.ORGANIZATION_ID = "jedv-local";
	process.env.HOST_DB_PATH = join(appHome, "host.db");
	process.env.HOST_MIGRATIONS_FOLDER = resolve(
		import.meta.dirname,
		"../../drizzle",
	);
	process.env.NODE_ENV = "development";
	const { getNotifyScriptContent } = await import("@jedv/agent-setup");
	mkdirSync(join(appHome, "hooks"));
	writeFileSync(join(appHome, "hooks/notify.sh"), getNotifyScriptContent(), {
		mode: 0o755,
	});

	const fixturePath = resolve(
		import.meta.dirname,
		"../../.cache/node-fixture/host.mjs",
	);
	assert.ok(
		existsSync(fixturePath),
		"Run bun run scripts/build-node-fixture.ts before Node PTY tests",
	);
	builtHost = (await import(
		pathToFileURL(fixturePath).href
	)) as BuiltHostFixture;
	terminal = builtHost.terminal;
	daemonClient = builtHost.daemonClient;
	const { initTerminalBaseEnv, __setAccountShellForTesting } = builtHost;
	__setAccountShellForTesting("/bin/sh");
	initTerminalBaseEnv({
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: userHome,
		SHELL: "/bin/sh",
		JEDV_USER_HOME_DIR: userHome,
		JEDV_DEBUG_HOOKS: "0",
		JEDV_FIXTURE_CLI: cliBin,
		JEDV_FIXTURE_LOG_DIR: logs,
	});
	daemon = new Server({ socketPath, daemonVersion: "0.0.0-teamwork-fixture" });
	await daemon.listen();
	await boot();
	for (const [id, name, setup] of [
		[projectId, "repo-a", false],
		[otherProjectId, "repo-b", true],
	] as const) {
		const repo = join(root, name);
		mkdirSync(repo);
		await run("git", ["init", "-b", "main", repo]);
		writeFileSync(join(repo, "README.md"), "isolated M1 fixture\n");
		if (setup) {
			mkdirSync(join(repo, ".jedv"));
			writeFileSync(
				join(repo, ".jedv/config.json"),
				JSON.stringify({ setup: ["printf ready > setup-evidence"] }),
			);
		}
		await run("git", ["-C", repo, "add", "."]);
		await run("git", [
			"-C",
			repo,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@invalid",
			"commit",
			"-qm",
			"fixture seed",
		]);
		host.db
			.insert(projects)
			.values({
				id,
				name,
				repoPath: repo,
				worktreeBaseDir: join(root, "worktrees", name),
			})
			.run();
	}
	for (const [id, name] of [
		[workspaceId, "Current"],
		[otherWorkspaceId, "Specified"],
	] as const)
		host.db
			.insert(workspaces)
			.values({
				id,
				projectId,
				name,
				worktreePath: join(root, "repo-a"),
				type: "local",
				branch: "main",
			})
			.run();
	host.db
		.insert(hostAgentConfigs)
		.values({
			id: "fixture",
			presetId: "claude",
			label: "Deterministic native fixture",
			command: process.execPath,
			argsJson: JSON.stringify([
				resolve(import.meta.dirname, "fixtures/native-agent.mjs"),
			]),
			promptTransport: "argv",
			displayOrder: 0,
			envJson: JSON.stringify({
				ELECTRON_RUN_AS_NODE: "1",
				JEDV_FIXTURE_CLI: cliBin,
				JEDV_FIXTURE_LOG_DIR: logs,
				JEDV_DEBUG_HOOKS: "0",
			}),
		})
		.run();
});

after(async () => {
	try {
		if (host) await closeHost();
	} finally {
		await daemon?.close();
		rmSync(join(userHome, ".codex/auth.json"), { force: true });
		if (process.env.JEDV_KEEP_TEAMWORK_FIXTURE !== "1")
			rmSync(root, { recursive: true, force: true });
		else console.error("[teamwork-fixture] retained", root);
	}
});

test(
	"real native leader CLI, three spawn modes, batched busy/idle mail, HTTP and lifecycle",
	{ timeout: 120_000 },
	async () => {
		const leader = await client.agents.run.mutate({
			workspaceId,
			agent: "fixture",
			prompt: "leader",
			surface: "terminal",
		});
		leaderTerminalId = leader.sessionId;
		const initial = await record<{ team: { id: string } }>(
			`${leaderTerminalId}.team.json`,
		);
		teamId = initial.team.id;
		await record(`${leaderTerminalId}.ready.json`);
		const repeated = await cli(
			[
				"team",
				"init",
				"--name",
				"PTY Team",
				"--goal",
				"isolated M1 validation",
			],
			{ workspaceId, terminalId: leaderTerminalId },
		);
		assert.equal(repeated.team.id, teamId);
		await client.terminal.writeInput.mutate({
			workspaceId,
			terminalId: leaderTerminalId,
			data: "busy\r",
		});
		await record(`${leaderTerminalId}.busy.json`);
		const current = await cli(
			[
				"team",
				"spawn",
				"--name",
				"current",
				"--agent",
				"fixture",
				"--prompt",
				"work",
			],
			{ workspaceId, terminalId: leaderTerminalId },
		);
		const specified = await cli([
			"team",
			"spawn",
			"--team",
			teamId,
			"--name",
			"specified",
			"--agent",
			"fixture",
			"--prompt",
			"work",
			"--workspace",
			otherWorkspaceId,
			"--human",
		]);
		await record(`${current.terminalId}.ready.json`);
		await record(`${specified.terminalId}.ready.json`);
		let inbox = await client.mail.inbox.query({
			teamId,
			member: "leader",
			includeAcked: true,
		});
		assert.equal(inbox.items.length, 2);
		assert.ok(inbox.items.every((x) => x.delivery.nudgeState === "pending"));
		writeFileSync(join(logs, `${leaderTerminalId}.release`), "release");
		const handled = await record<{ deliveries: string[]; text: string }>(
			`${leaderTerminalId}.handled-1.json`,
		);
		assert.equal(handled.deliveries.length, 2);
		assert.ok(!handled.text.includes("ready:current"));
		inbox = await client.mail.inbox.query({
			teamId,
			member: "leader",
			includeAcked: true,
		});
		assert.ok(
			inbox.items.every(
				(x) =>
					x.delivery.readAt !== null &&
					x.delivery.ackedAt !== null &&
					x.delivery.nudgeState === "nudged",
			),
		);
		assert.equal(
			new Set(inbox.items.map((x) => x.delivery.wakeBatchId)).size,
			1,
		);
		const cross = await cli([
			"team",
			"spawn",
			"--team",
			teamId,
			"--name",
			"cross",
			"--agent",
			"fixture",
			"--prompt",
			"work",
			"--project",
			otherProjectId,
			"--human",
		]);
		const crossReady = await record<{ cwd: string; workspaceId: string }>(
			`${cross.terminalId}.ready.json`,
		);
		await record(`${leaderTerminalId}.handled-2.json`);
		assert.notEqual(cross.workspaceId, workspaceId);
		assert.equal(crossReady.workspaceId, cross.workspaceId);
		assert.equal(
			readFileSync(join(crossReady.cwd, "setup-evidence"), "utf8"),
			"ready",
		);
		assert.equal(
			host.db
				.select()
				.from(workspaceSetup)
				.where(eq(workspaceSetup.workspaceId, cross.workspaceId))
				.get()?.status,
			"succeeded",
		);
		const duplicate = await cli(
			[
				"team",
				"spawn",
				"--name",
				"current",
				"--agent",
				"fixture",
				"--prompt",
				"work",
			],
			{ workspaceId, terminalId: leaderTerminalId },
		);
		assert.equal(duplicate.terminalId, current.terminalId);
		await cli(["team", "pause", "--team", teamId, "--human"]);
		const seed = await client.mail.send.mutate({
			teamId,
			to: "current",
			body: "watch seed",
			type: "message",
			subject: "",
			dedupeKey: "watch-seed",
		});
		const watcher = spawn(
			cliBin,
			[
				"mail",
				"watch",
				"--team",
				teamId,
				"--member",
				"current",
				"--human",
				"--timeout",
				"600",
			],
			{
				env: {
					...process.env,
					JEDV_HOME_DIR: appHome,
					JEDV_USER_HOME_DIR: userHome,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		assert.ok(watcher.stdout);
		const reader = createInterface({ input: watcher.stdout });
		const lines = reader[Symbol.asyncIterator]();
		try {
			const first = await lines.next();
			assert.equal(first.done, false);
			assert.equal(JSON.parse(first.value ?? "{}").event.id, seed.event.id);
			const fresh = await client.mail.send.mutate({
				teamId,
				to: "current",
				body: "arrived over WebSocket",
				type: "message",
				subject: "",
				dedupeKey: "watch-new",
			});
			const second = await lines.next();
			assert.equal(second.done, false);
			assert.equal(JSON.parse(second.value ?? "{}").event.id, fresh.event.id);
		} finally {
			reader.close();
			const exited = once(watcher, "exit", {
				signal: AbortSignal.timeout(5000),
			});
			watcher.kill("SIGINT");
			await exited;
		}
		const response = await fetch(`${endpoint}/api/v1/mail`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${psk}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				teamId,
				to: "current",
				body: "paused human mail",
				dedupeKey: "paused-human",
			}),
		});
		assert.equal(response.status, 200);
		const paused = (await response.json()) as {
			deliveries: { id: string; nudgeState: string }[];
		};
		assert.equal(paused.deliveries[0]?.nudgeState, "pending");
		assert.equal(
			(await fetch(`${endpoint}/api/v1/mail/inbox?teamId=${teamId}`)).status,
			401,
		);
		assert.equal(
			(
				await fetch(`${endpoint}/api/v1/openapi.json`, {
					headers: { Authorization: `Bearer ${psk}` },
				})
			).status,
			200,
		);
		assert.ok(
			(await (await daemonClient.getDaemonClient()).list()).some(
				(s) => s.id === current.terminalId,
			),
		);
		await cli(["team", "resume", "--team", teamId, "--human"]);
		await record(`${current.terminalId}.handled-1.json`);
		await client.mail.send.mutate({
			teamId,
			to: "leader",
			type: "fixture.ping",
			body: "ping-pong",
			subject: "",
			payload: { peer: current.id },
			dedupeKey: "ping-seed",
		});
		const limited = await record<{
			hop: number;
			deliveries: { nudgeState: string }[];
		}>(`${current.terminalId}.ping-hop-8.json`);
		assert.equal(limited.hop, 8);
		assert.equal(limited.deliveries[0]?.nudgeState, "suppressed_hop_limit");
		await client.mail.send.mutate({
			teamId,
			to: "leader",
			type: "fixture.independent",
			body: "fresh independent human task",
			subject: "",
			dedupeKey: "independent-after-hop-limit",
		});
		await record(`${leaderTerminalId}.independent.json`);
		const before = new Set(
			(await (await daemonClient.getDaemonClient()).list()).map((s) => s.id),
		);
		// Crash evidence is seeded while paused so no worker can consume it.
		await client.team.pause.mutate({ teamId });
		const crash = await client.mail.send.mutate({
			teamId,
			to: "current",
			body: "crash boundary",
			type: "message",
			subject: "",
			dedupeKey: "crash",
		});
		host.db
			.update(mailDeliveries)
			.set({ nudgeState: "inflight", inflightToken: "crashed-before-ack" })
			.where(eq(mailDeliveries.id, crash.deliveries[0]?.id ?? ""))
			.run();
		host.db
			.update(teamMembers)
			.set({ status: "spawning", terminalId: null })
			.where(eq(teamMembers.id, current.id))
			.run();
		const terminalCreatedAt = host.db
			.select()
			.from(terminalSessions)
			.where(eq(terminalSessions.id, current.terminalId))
			.get()?.createdAt;
		assert.ok(terminalCreatedAt);
		await closeHost();
		await boot();
		const recovered = await client.team.status.query({ teamId });
		assert.equal(
			recovered.members.find((x) => x.id === current.id)?.terminalId,
			current.terminalId,
		);
		assert.equal(
			host.db
				.select()
				.from(terminalSessions)
				.where(eq(terminalSessions.id, current.terminalId))
				.get()?.createdAt,
			terminalCreatedAt,
		);
		assert.equal(
			host.db
				.select()
				.from(mailDeliveries)
				.where(eq(mailDeliveries.id, crash.deliveries[0]?.id ?? ""))
				.get()?.nudgeState,
			"uncertain_staged",
		);
		const afterRestart = new Set(
			(await (await daemonClient.getDaemonClient()).list()).map((s) => s.id),
		);
		assert.deepEqual(afterRestart, before);
		const binding = host.terminalAgentStore.get(leaderTerminalId);
		assert.ok(binding);
		assert.equal(
			host.terminalAgentStore.getAutomaticDeliveryState(binding),
			"unknown",
		);
		await cli(["team", "stop", "--team", teamId, "--human"]);
		assert.ok(
			(await (await daemonClient.getDaemonClient()).list()).some(
				(s) => s.id === leaderTerminalId,
			),
		);
		await cli(["team", "archive", "--team", teamId, "--human"]);
		assert.ok(existsSync(crossReady.cwd));
	},
);

test(
	"GUI seed helper provisions a live Team through the existing isolated host",
	{ timeout: 45_000 },
	async () => {
		const { stdout } = await run(
			process.execPath,
			[
				"--import",
				"tsx",
				resolve(import.meta.dirname, "../../scripts/seed-teamwork-fixture.ts"),
			],
			{
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					JEDV_HOME_DIR: appHome,
					JEDV_USER_HOME_DIR: userHome,
					JEDV_FIXTURE_WORKSPACE_ID: workspaceId,
					JEDV_FIXTURE_PAUSED: "1",
				},
				maxBuffer: 2 * 1024 * 1024,
			},
		);
		const seeded = JSON.parse(stdout) as {
			teamId: string;
			leaderTerminalId: string;
			workerTerminalId: string;
		};
		const status = await client.team.status.query({ teamId: seeded.teamId });
		assert.equal(status.team.status, "paused");
		assert.equal(status.members.length, 2);
		assert.ok(
			status.members.some(
				(x) =>
					x.terminalId === seeded.workerTerminalId &&
					x.boundAgentSessionId !== null,
			),
		);
		await client.team.stop.mutate({ teamId: seeded.teamId });
		await terminal.disposeSessionAndWait(seeded.leaderTerminalId, host.db);
	},
);

test(
	"ordinary folder: real CLI import/workspace, PTY Team/Mail, restart, archive/delete/purge preserve files",
	{ timeout: 90_000 },
	async () => {
		const folder = join(root, "ordinary-user-folder");
		mkdirSync(folder);
		writeFileSync(join(folder, "keep.txt"), "user-owned ordinary folder\n");
		const imported = await cli([
			"projects",
			"create",
			"--local",
			"--name",
			"Folder project",
			"--folder",
			folder,
		]);
		const folderProjectId = imported.projectId;
		assert.ok(folderProjectId);
		const folderProject = await client.project.get.query({
			projectId: folderProjectId,
		});
		assert.equal(folderProject?.vcsKind, "none");
		assert.deepEqual(folderProject.capabilities, {
			git: false,
			pullRequests: false,
			worktrees: false,
		});
		const created = await client.workspaces.create.mutate({
			projectId: folderProjectId,
			checkout: "local",
			name: "Ordinary work",
			trackSetupCompletion: true,
		});
		const folderWorkspaceId = created.workspace.id;
		assert.equal(created.workspace.vcsKind, "none");
		assert.equal(created.workspace.branch, "");
		assert.equal(existsSync(join(folder, ".git")), false);
		// CLI creates another identity over the same files, without initializing Git.
		await cli([
			"workspaces",
			"create",
			"--local",
			"--project",
			folderProjectId,
			"--checkout",
			"local",
			"--name",
			"Second folder identity",
		]);
		const leader = await client.agents.run.mutate({
			workspaceId: folderWorkspaceId,
			agent: "fixture",
			prompt: "leader",
			surface: "terminal",
		});
		const initial = await record<{ team: { id: string } }>(
			`${leader.sessionId}.team.json`,
		);
		const folderTeamId = initial.team.id;
		await record(`${leader.sessionId}.ready.json`);
		const worker = await cli([
			"team",
			"spawn",
			"--team",
			folderTeamId,
			"--name",
			"folder-worker",
			"--agent",
			"fixture",
			"--prompt",
			"work",
		]);
		const ready = await record<{ cwd: string }>(
			`${worker.terminalId}.ready.json`,
		);
		assert.equal(ready.cwd, folderProject.repoPath);
		await record(`${leader.sessionId}.handled-1.json`);
		const actor = {
			workspaceId: folderWorkspaceId,
			terminalId: leader.sessionId,
		};
		// New worktrees are rejected before intent or PTY creation, including the real CLI path.
		const beforeMembers = (
			await client.team.status.query({ teamId: folderTeamId })
		).members.length;
		await assert.rejects(
			cli([
				"team",
				"spawn",
				"--team",
				folderTeamId,
				"--project",
				folderProjectId,
				"--name",
				"forbidden",
				"--agent",
				"fixture",
				"--prompt",
				"work",
			]),
			/Git, pull requests and worktrees are unavailable/,
		);
		assert.equal(
			(await client.team.status.query({ teamId: folderTeamId })).members.length,
			beforeMembers,
		);
		await assert.rejects(
			client.git.getStatus.query({ workspaceId: folderWorkspaceId }),
			/unavailable for this folder/,
		);
		await assert.rejects(
			client.workspaceCreation.listProjectWorktrees.query({
				projectId: folderProjectId,
			}),
			/unavailable for this folder/,
		);
		await assert.rejects(
			client.pullRequests.createForWorkspace.mutate({
				workspaceId: folderWorkspaceId,
				title: "No folder PR",
			}),
			/unavailable for this folder/,
		);
		await client.terminal.writeInput.mutate({ ...actor, data: "busy\r" });
		await record(`${leader.sessionId}.busy.json`);
		await cli([
			"mail",
			"send",
			"--team",
			folderTeamId,
			"--to",
			"leader",
			"--body",
			"Folder mail while busy",
			"--dedupe-key",
			"folder-busy",
			"--human",
		]);
		writeFileSync(join(logs, `${leader.sessionId}.release`), "release");
		await record(`${leader.sessionId}.handled-2.json`);
		const inbox = await client.mail.inbox.query({
			teamId: folderTeamId,
			actor,
			includeAcked: true,
		});
		assert.ok(
			inbox.items.some(
				(item) =>
					item.event.body === "Folder mail while busy" &&
					item.delivery.ackedAt !== null,
			),
		);
		await closeHost();
		await boot();
		assert.equal(
			(await client.project.get.query({ projectId: folderProjectId }))?.vcsKind,
			"none",
		);
		assert.equal(
			(await client.team.status.query({ teamId: folderTeamId })).members.length,
			2,
		);
		await client.team.stop.mutate({ teamId: folderTeamId });
		assert.ok(
			(await (await daemonClient.getDaemonClient()).list()).some(
				(s) => s.id === leader.sessionId,
			),
		);
		await client.team.archive.mutate({ teamId: folderTeamId });
		const inspection = await client.workspaceCleanup.inspect.query({
			workspaceId: folderWorkspaceId,
		});
		assert.equal(inspection.sharesProjectCheckout, true);
		await cli(["workspaces", "archive", folderWorkspaceId, "--local"]);
		assert.equal(
			readFileSync(join(folder, "keep.txt"), "utf8"),
			"user-owned ordinary folder\n",
		);
		await client.project.remove.mutate({ projectId: folderProjectId });
		await client.project.purge.mutate({ projectId: folderProjectId });
		assert.equal(
			readFileSync(join(folder, "keep.txt"), "utf8"),
			"user-owned ordinary folder\n",
		);
		assert.equal(existsSync(join(folder, ".git")), false);
	},
);

test(
	"atomic Team start opens an owned Leader in an ordinary folder, preserves pre-hook CLI mail, and never relaunches on retry/restart",
	{ timeout: 60_000 },
	async () => {
		const folder = join(root, "start-folder");
		mkdirSync(folder);
		writeFileSync(join(folder, "user.txt"), "preserved");
		const project = await client.project.create.mutate({
			name: "Start folder",
			mode: { kind: "folder", repoPath: folder },
		});
		const created = await client.workspaces.create.mutate({
			projectId: project.projectId,
			checkout: "local",
			name: "New task",
		});
		const input = {
			operationId: randomUUID(),
			workspaceId: created.workspace.id,
			agent: "fixture",
			prompt: "  prehook-start\n    preserve task indentation\n",
		};
		assert.equal(
			(await client.team.capabilities.query()).features?.start,
			true,
		);
		const [first, repeated] = await Promise.all([
			client.team.start.mutate(input),
			client.team.start.mutate(input),
		]);
		assert.equal(first.team.id, repeated.team.id);
		assert.equal(first.team.goal, input.prompt);
		const leader = first.members.find((m) => m.role === "leader");
		assert.ok(leader?.terminalId);
		assert.equal(leader.launchState, "starting");
		assert.equal(leader.boundStartedAt, null);
		await record(`${leader.terminalId}.pre-hook.json`);
		const queued = await client.mail.send.mutate({
			teamId: first.team.id,
			to: "leader",
			body: "human mail while Leader is starting",
			dedupeKey: "start-pending",
		});
		assert.equal(queued.deliveries[0]?.nudgeState, "pending");
		assert.equal(host.terminalAgentStore.get(leader.terminalId), undefined);
		const screen = await terminal.snapshotSession({
			terminalId: leader.terminalId,
			workspaceId: created.workspace.id,
			db: host.db,
			maxLines: 60,
		});
		assert.ok(!JSON.stringify(screen).includes("[Jedv Mail "));
		writeFileSync(join(logs, `${leader.terminalId}.allow-cli`), "go");
		const early = await record<{ event: { sourceKind: string } }>(
			`${leader.terminalId}.pre-hook-cli.json`,
		);
		assert.equal(early.event.sourceKind, "member");
		assert.equal(
			(await client.team.status.query({ teamId: first.team.id })).members[0]
				?.launchState,
			"starting",
		);
		writeFileSync(join(logs, `${leader.terminalId}.allow-hooks`), "go");
		const ready = await record<{ prompt: string }>(
			`${leader.terminalId}.ready.json`,
		);
		assert.equal(ready.prompt, input.prompt);
		await record(`${leader.terminalId}.handled-1.json`);
		assert.equal(
			(await client.team.status.query({ teamId: first.team.id })).members[0]
				?.launchState,
			"bound",
		);
		const before = new Set(
			(await (await daemonClient.getDaemonClient()).list()).map((s) => s.id),
		);
		await assert.rejects(
			client.team.start.mutate({ ...input, prompt: "changed task" }),
			/different Team start parameters/,
		);
		const retried = await cli([
			"team",
			"start",
			"--operation-id",
			input.operationId,
			"--workspace",
			input.workspaceId,
			"--agent",
			input.agent,
			"--prompt",
			input.prompt,
		]);
		assert.equal(retried.team.id, first.team.id);
		await closeHost();
		await boot();
		const recovered = await client.team.start.mutate(input);
		assert.equal(recovered.members[0]?.terminalId, leader.terminalId);
		assert.equal(recovered.team.goal, input.prompt);
		assert.deepEqual(
			new Set(
				(await (await daemonClient.getDaemonClient()).list()).map((s) => s.id),
			),
			before,
		);
		await client.team.stop.mutate({ teamId: first.team.id });
		await client.team.archive.mutate({ teamId: first.team.id });
		await terminal.disposeSessionAndWait(leader.terminalId, host.db);
		assert.equal(readFileSync(join(folder, "user.txt"), "utf8"), "preserved");
		assert.equal(existsSync(join(folder, ".git")), false);
	},
);

test(
	"a configured real Codex Agent launches in its own isolated profile",
	{ skip: process.env.JEDV_REAL_AGENT_SMOKE !== "1", timeout: 120_000 },
	async () => {
		assert.ok(
			existsSync(join(realCodexHome, "auth.json")),
			"Configured Codex credential is required for this smoke",
		);
		const codexHome = join(userHome, ".codex");
		mkdirSync(codexHome, { recursive: true });
		copyFileSync(
			join(realCodexHome, "auth.json"),
			join(codexHome, "auth.json"),
		);
		const originalConfig = existsSync(join(realCodexHome, "config.toml"))
			? readFileSync(join(realCodexHome, "config.toml"), "utf8")
			: "";
		const model = originalConfig.match(/^model\s*=\s*("[^"\n]+")/m)?.[1];
		writeFileSync(
			join(codexHome, "config.toml"),
			model ? `model = ${model}\n` : "",
			{ mode: 0o600 },
		);
		const output = join(logs, "real-agent-answer.txt");
		host.db
			.insert(hostAgentConfigs)
			.values({
				id: "real-smoke",
				presetId: "codex",
				label: "Isolated real smoke",
				command: "/opt/homebrew/bin/codex",
				argsJson: JSON.stringify([
					"exec",
					"--sandbox",
					"read-only",
					"--skip-git-repo-check",
					"--output-last-message",
					output,
				]),
				promptTransport: "argv",
				displayOrder: 100,
				envJson: JSON.stringify({ CODEX_HOME: codexHome }),
			})
			.run();
		const actor = { workspaceId, terminalId: leaderTerminalId };
		const fresh = await client.team.init.mutate({
			actor,
			name: "Real smoke Team",
			goal: "One isolated no-tools response",
			leaderName: "leader",
		});
		await client.team.spawn.mutate({
			teamId: fresh.team.id,
			name: "real",
			operationId: "real-smoke",
			agent: "real-smoke",
			prompt:
				"Reply with exactly M1_REAL_AGENT_SMOKE_OK. Do not call tools or modify files.",
			newWorktree: false,
		});
		const answers = watch(logs, { signal: AbortSignal.timeout(90_000) });
		try {
			if (!existsSync(output) || !readFileSync(output, "utf8").trim()) {
				for await (const _event of answers)
					if (existsSync(output) && readFileSync(output, "utf8").trim()) break;
			}
		} finally {
			await answers.return?.();
		}
		assert.equal(readFileSync(output, "utf8").trim(), "M1_REAL_AGENT_SMOKE_OK");
		await client.team.stop.mutate({ teamId: fresh.team.id });
	},
);
