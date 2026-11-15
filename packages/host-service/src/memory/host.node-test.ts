import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";
import type { CreateAppResult } from "../app";
import {
	mailDeliveries,
	mailEvents,
	projects,
	teamMembers,
	teams,
	terminalSessions,
	workspaces,
} from "../db/schema";
import type { AppRouter } from "../trpc/router";

const run = promisify(execFile);
const repo = resolve(process.env.JEDV_M3_REPO ?? process.cwd());

test("real Host persists Memory, serves root tRPC/HTTP/OpenAPI and actual CLI, samples WatchDog, fake/no-key extraction", async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "jedv-m3-host-")));
	const home = join(root, "app"),
		user = join(root, "user"),
		project = join(root, "project");
	for (const dir of [home, user, project]) mkdirSync(dir);
	process.env.JEDV_HOME_DIR = home;
	process.env.JEDV_USER_HOME_DIR = user;
	process.env.HOST_CLIENT_ID = "memory-node-fixture";
	process.env.NODE_ENV = "test";
	const { createApp } = await import("../app");
	const { PskHostAuthProvider } = await import("../providers/host-auth");
	const { issueAttributionToken } = await import(
		"../terminal-agents/attribution-token"
	);
	const key = `isolated-test-${randomUUID()}`,
		token = randomUUID();
	let requests = 0;
	let tick = () => {};
	const now = 10000000;
	let host: CreateAppResult | undefined;
	let http: ReturnType<typeof serve> | undefined;
	let client: ReturnType<typeof createTRPCClient<AppRouter>> | undefined;
	let endpoint = "";
	async function boot() {
		host = createApp({
			config: {
				organizationId: "jedv-local",
				dbPath: join(home, "host.db"),
				migrationsFolder: join(repo, "packages/host-service/drizzle"),
				allowedOrigins: [],
			},
			providers: {
				hostAuth: new PskHostAuthProvider(token),
				credentials: {
					getCredentials: async () => ({
						env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
					}),
					getToken: async () => null,
					credentialRemedy: () => "Fixture has no external credentials",
				},
			},
			memory: {
				home: () => home,
				transcriptHome: () => user,
				clock: {
					now: () => now,
					setInterval(fn, ms) {
						assert.equal(ms, 30000);
						tick = fn;
						return () => {
							tick = () => {};
						};
					},
				},
				deepseek: {
					fetch: async (url, init) => {
						requests++;
						assert.equal(
							String(url),
							"https://api.deepseek.com/chat/completions",
						);
						const body = JSON.parse(String(init?.body));
						assert.equal(body.model, "deepseek-flash");
						assert.deepEqual(body.thinking, { type: "disabled" });
						assert.deepEqual(body.response_format, { type: "json_object" });
						const content = JSON.stringify({
							entries: [
								{
									scopeKind: "project",
									title: "Runner",
									content: "Use Bun for every package script",
									evidence: "Use Bun for all project scripts",
									tier: "core",
									category: "convention",
								},
								{
									scopeKind: "global",
									title: "Runner",
									content: "Prefer Bun globally",
									evidence: "Use Bun for all project scripts",
									tier: "core",
									category: "convention",
								},
							],
						});
						return new Response(
							JSON.stringify({
								choices: [{ finish_reason: "stop", message: { content } }],
							}),
						);
					},
				},
			},
		});
		http = serve({ fetch: host.app.fetch, hostname: "127.0.0.1", port: 0 });
		if (!http.listening)
			await new Promise<void>((r) => http?.once("listening", r));
		const address = http.address();
		assert.ok(address && typeof address !== "string");
		endpoint = `http://127.0.0.1:${address.port}`;
		const manifest = join(home, "host/jedv-local");
		mkdirSync(manifest, { recursive: true });
		writeFileSync(
			join(manifest, "manifest.json"),
			JSON.stringify({
				pid: process.pid,
				endpoint,
				authToken: token,
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
					headers: { Authorization: `Bearer ${token}` },
				}),
			],
		});
	}
	async function close() {
		await host?.dispose();
		if (http && "closeAllConnections" in http) http.closeAllConnections();
		if (http) await new Promise<void>((r) => http?.close(() => r()));
		host = undefined;
		http = undefined;
	}
	async function cli(args: string[]) {
		const { stdout } = await run("bun", ["run", "dev", ...args, "--json"], {
			cwd: join(repo, "packages/cli"),
			env: {
				...process.env,
				CI: "1",
				JEDV_TEAM_ID: "",
				JEDV_PROJECT_ID: "",
				JEDV_WORKSPACE_ID: "",
				JEDV_TERMINAL_ID: "",
			},
			maxBuffer: 4e6,
		});
		return JSON.parse(stdout);
	}
	try {
		await boot();
		assert.ok(client);
		assert.ok(host);
		assert.deepEqual(await client.aiSettings.get.query(), {
			configured: false,
			maskedHint: null,
		});
		host.db
			.insert(projects)
			.values({ id: "p", name: "Fixture", repoPath: project })
			.run();
		host.db
			.insert(workspaces)
			.values({
				id: "w",
				projectId: "p",
				worktreePath: project,
				type: "local",
				branch: "main",
			})
			.run();
		host.db
			.insert(terminalSessions)
			.values({ id: "terminal", originWorkspaceId: "w" })
			.run();
		host.db
			.insert(teams)
			.values({
				id: "team",
				name: "Team",
				goal: "",
				status: "active",
				createdAt: 1,
				updatedAt: 1,
			})
			.run();
		const put = await cli([
			"memory",
			"put",
			"--scope",
			"project",
			"--project",
			"p",
			"--title",
			"幂等 mail",
			"--content",
			"可信幂等投递",
		]);
		assert.equal(put.status, "active");
		assert.equal(
			(
				await cli([
					"memory",
					"search",
					"幂等",
					"--scope",
					"project",
					"--project",
					"p",
				])
			).length,
			1,
		);
		await cli(["memory", "export", "--scope", "project", "--project", "p"]);
		await cli([
			"memory",
			"import",
			"--scope",
			"project",
			"--project",
			"p",
			"--file",
			".jedv/memory.json",
		]);
		assert.equal(
			(await client.memory.list.query({ scopeKind: "project", scopeId: "p" }))
				.length,
			1,
		);
		const headers = { Authorization: `Bearer ${token}` };
		assert.equal(
			(await fetch(`${endpoint}/api/v1/memory?scopeKind=global`)).status,
			401,
		);
		const openapi = (await (
			await fetch(`${endpoint}/api/v1/openapi.json`, { headers })
		).json()) as { paths: Record<string, Record<string, unknown>> };
		assert.ok(openapi.paths["/api/v1/memory"]?.get);
		assert.ok(openapi.paths["/api/v1/memory"]?.post);
		assert.ok(openapi.paths["/api/v1/mail"]);
		assert.equal(
			(
				await fetch(
					endpoint +
						"/api/v1/memory/search?query=" +
						encodeURIComponent("幂等"),
					{ headers },
				)
			).status,
			200,
		);
		await close();
		await boot();
		assert.ok(client);
		assert.ok(host);
		assert.equal(
			(await client.memory.search.query({ query: "幂等" })).length,
			1,
		);
		assert.deepEqual(await client.aiSettings.get.query(), {
			configured: false,
			maskedHint: null,
		});
		// Real Automation store and real Mail tables drive the rule adapter with a manual Clock.
		host.db
			.insert(teamMembers)
			.values({
				id: "m",
				teamId: "team",
				name: "leader",
				role: "leader",
				status: "active",
				operationId: "m",
				requestFingerprint: "m",
				requestJson: "{}",
				agentId: "claude",
				taskSummary: "task",
				joinedAt: 1,
			})
			.run();
		host.db
			.insert(mailEvents)
			.values({
				id: "e",
				teamId: "team",
				threadId: "e",
				type: "message",
				sourceKind: "human",
				sourceId: "human",
				dedupeKey: "e",
				requestFingerprint: "e",
				subject: "subject",
				body: "body",
				createdAt: 1,
			})
			.run();
		host.db
			.insert(mailDeliveries)
			.values({
				id: "d",
				eventId: "e",
				recipientMemberId: "m",
				nudgeState: "not_applicable",
				createdAt: 1,
				readAt: 2,
			})
			.run();
		tick();
		await host.memoryRuntime.watchdog.scan();
		assert.equal((await client.watchdog.listAlerts.query()).length, 1);
		await host.memoryRuntime.watchdog.scan();
		assert.equal((await client.watchdog.listAlerts.query()).length, 1);
		// Authenticated source Hook is exercised after the two coordinated source changes land.
		const transcript = join(user, "session.jsonl");
		writeFileSync(
			transcript,
			JSON.stringify({
				role: "user",
				content: "Use Bun for all project scripts",
			}),
		);
		const store = host.terminalAgentStore;
		store.recordEvent({
			terminalId: "terminal",
			workspaceId: "w",
			agentId: "claude",
			agentSessionId: "session",
			launchId: "launch",
			eventType: "Attached",
			occurredAt: 1,
		});
		const hook = {
			terminalId: "terminal",
			eventType: "Interrupt",
			launchId: "launch",
			agent: { agentId: "claude", sessionId: "session" },
			deliverySequence: 1,
			transcriptPath: transcript,
			attributionToken: issueAttributionToken("terminal"),
		};
		await client.notifications.hook.mutate(hook);
		await host.memoryRuntime.flushExtractions();
		assert.equal(requests, 0);
		const setting = await client.aiSettings.setDeepseekKey.mutate({
			apiKey: key,
		});
		assert.equal(setting.configured, true);
		assert.ok(!JSON.stringify(setting).includes(key));
		assert.equal(
			statSync(join(home, "secrets/deepseek.key")).mode & 0o777,
			0o600,
		);
		await client.notifications.hook.mutate({ ...hook, deliverySequence: 2 });
		await host.memoryRuntime.flushExtractions();
		assert.equal(requests, 1);
		const memories = await client.memory.list.query({
			scopeKind: "project",
			scopeId: "p",
		});
		assert.ok(
			memories.some(
				(m) => m.sourceKind === "watchdog" && m.sourceRef === "terminal",
			),
		);
		assert.equal(
			(await client.memory.list.query({ scopeKind: "global" })).length,
			0,
		);
		assert.equal(
			(
				await client.memory.list.query({
					scopeKind: "global",
					includeCandidates: true,
				})
			)[0]?.status,
			"candidate",
		);
		await client.notifications.hook.mutate({ ...hook, deliverySequence: 2 });
		await host.memoryRuntime.flushExtractions();
		assert.equal(requests, 1);
		await client.notifications.hook.mutate({
			...hook,
			deliverySequence: 3,
			attributionToken: "untrusted",
		});
		await host.memoryRuntime.flushExtractions();
		assert.equal(requests, 1);
		await client.notifications.hook.mutate({
			...hook,
			deliverySequence: 3,
			eventType: "SessionEnd",
		});
		await host.memoryRuntime.flushExtractions();
		assert.equal(requests, 2);
		await client.notifications.hook.mutate({
			...hook,
			deliverySequence: 3,
			eventType: "SessionEnd",
		});
		await host.memoryRuntime.flushExtractions();
		assert.equal(requests, 2);
		await client.aiSettings.setDeepseekKey.mutate({ apiKey: null });
		assert.equal(
			host.memoryRuntime.memory
				.injection({ projectId: "p", teamId: "team" })
				.text.includes("Use Bun"),
			true,
		);
		console.log(
			"M3 real Host/CLI evidence",
			JSON.stringify({
				root,
				requests,
				node: process.versions.node,
				abi: process.versions.modules,
				assertions:
					"persistence/FTS/JSON/OpenAPI/auth/secret/no-key/fake-hook/watchdog",
			}),
		);
	} finally {
		await close();
		rmSync(root, { recursive: true, force: true });
	}
});
