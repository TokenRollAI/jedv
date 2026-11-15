// Seed an already-running, explicitly isolated GUI host through its real APIs.
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { watch } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { getNotifyScriptContent } from "@jedv/agent-setup";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";
import type { AppRouter } from "../src/trpc/router";

function temporaryProfile(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Set ${name} to an isolated temporary profile`);
	const path = realpathSync(value);
	if (
		![realpathSync(tmpdir()), realpathSync("/tmp")].some((base) => {
			const rel = relative(base, path);
			return (
				rel !== "" &&
				rel !== ".." &&
				!rel.startsWith("../") &&
				!rel.startsWith("/")
			);
		})
	)
		throw new Error(`${name} must be below a temporary directory`);
	return path;
}
const appHome = temporaryProfile("JEDV_HOME_DIR"),
	userHome = temporaryProfile("JEDV_USER_HOME_DIR");
const workspaceId = process.env.JEDV_FIXTURE_WORKSPACE_ID;
if (!workspaceId)
	throw new Error(
		"Set JEDV_FIXTURE_WORKSPACE_ID to an existing temporary GUI workspace",
	);
const org = process.env.JEDV_FIXTURE_ORGANIZATION_ID ?? "jedv-local";
const manifest = JSON.parse(
	readFileSync(join(appHome, "host", org, "manifest.json"), "utf8"),
) as { endpoint: string; authToken: string };
const endpoint = new URL(manifest.endpoint);
if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
	throw new Error("Fixture only connects to a loopback host");
const client = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: `${manifest.endpoint}/trpc`,
			transformer: SuperJSON,
			headers: { Authorization: `Bearer ${manifest.authToken}` },
		}),
	],
});
await client.team.capabilities.query();
const cli = resolve(import.meta.dirname, "../../cli/dist/jedv");
if (!existsSync(cli)) throw new Error("Build packages/cli first");
const logs = join(appHome, "teamwork-fixture-records");
mkdirSync(logs, { recursive: true });
mkdirSync(join(appHome, "hooks"), { recursive: true });
writeFileSync(join(appHome, "hooks/notify.sh"), getNotifyScriptContent(), {
	mode: 0o755,
});
const args = [
	resolve(import.meta.dirname, "../src/teams/fixtures/native-agent.mjs"),
];
const configs = await client.settings.agentConfigs.list.query();
const label = "Jedv Teamwork native fixture";
const patch = {
	label,
	command: process.execPath,
	args,
	promptTransport: "argv" as const,
	promptArgs: [],
	resumeArgs: [],
	forkArgs: [],
	env: {
		ELECTRON_RUN_AS_NODE: "1",
		JEDV_USER_HOME_DIR: userHome,
		JEDV_FIXTURE_CLI: cli,
		JEDV_FIXTURE_LOG_DIR: logs,
		JEDV_DEBUG_HOOKS: "0",
	},
};
const existing = configs.find((config) => config.label === label);
const config = existing
	? await client.settings.agentConfigs.update.mutate({ id: existing.id, patch })
	: await client.settings.agentConfigs.add.mutate({
			...patch,
			presetId: "claude",
			iconId: "claude",
		});
async function readRecord<T>(terminalId: string, name: string): Promise<T> {
	const file = join(logs, `${terminalId}.${name}.json`),
		events = watch(logs, { signal: AbortSignal.timeout(20_000) });
	try {
		if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
		for await (const _event of events) {
			const error = join(logs, `${terminalId}.error.json`);
			if (existsSync(error)) throw new Error(readFileSync(error, "utf8"));
			if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
		}
		throw new Error("Fixture record missing");
	} finally {
		await events.return?.();
	}
}
const leader = await client.agents.run.mutate({
	workspaceId,
	agent: config.id,
	prompt: "leader",
	surface: "terminal",
});
const initialized = await readRecord<{ team: { id: string } }>(
	leader.sessionId,
	"team",
);
await readRecord(leader.sessionId, "ready");
const teamId = initialized.team.id;
const worker = await client.team.spawn.mutate({
	teamId,
	name: "fixture-worker",
	operationId: "gui-worker",
	agent: config.id,
	prompt: "GUI fixture worker",
	newWorktree: false,
});
if (worker.terminalId) await readRecord(worker.terminalId, "ready");
if (process.env.JEDV_FIXTURE_CROSS_PROJECT_ID)
	await client.team.spawn.mutate({
		teamId,
		name: "cross-project",
		operationId: "gui-cross-project",
		agent: config.id,
		prompt: "GUI cross-project fixture",
		projectId: process.env.JEDV_FIXTURE_CROSS_PROJECT_ID,
		newWorktree: true,
	});
if (process.env.JEDV_FIXTURE_PAUSED === "1") {
	await client.team.pause.mutate({ teamId });
	await client.mail.send.mutate({
		teamId,
		to: "leader",
		body: "Pending GUI fixture mail",
		subject: "GUI fixture",
		type: "human.message",
		dedupeKey: "gui-pending",
	});
}
console.log(
	JSON.stringify(
		{
			teamId,
			leaderTerminalId: leader.sessionId,
			workerTerminalId: worker.terminalId,
			agentConfigId: config.id,
			records: logs,
		},
		null,
		2,
	),
);
