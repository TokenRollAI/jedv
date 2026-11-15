import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
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
import { eq } from "drizzle-orm";
import SuperJSON from "superjson";
import type { CreateAppResult } from "../app";
import {
	mailEvents,
	projects,
	teamMembers,
	teams,
	terminalSessions,
	workspaces,
} from "../db/schema";
import type { AppRouter } from "../trpc/router";

const run = promisify(execFile),
	repo = resolve(process.env.JEDV_M4_REPO ?? process.cwd());
const toolResponse = (name: string, args: unknown, id = "call1") =>
	new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: "tool_calls",
					message: {
						content: null,
						tool_calls: [
							{
								id,
								type: "function",
								function: { name, arguments: JSON.stringify(args) },
							},
						],
					},
				},
			],
		}),
	);
const finalResponse = (content: string) =>
	new Response(
		JSON.stringify({
			choices: [{ finish_reason: "stop", message: { content } }],
		}),
	);
test("real Butler Host/CLI: persistent conversation, native tools, verbatim Leader mail and replies, archive/stop approvals", async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "jedv-butler-host-"))),
		home = join(root, "app"),
		user = join(root, "user"),
		project = join(root, "repo");
	for (const dir of [home, user, project]) mkdirSync(dir);
	process.env.JEDV_HOME_DIR = home;
	process.env.JEDV_USER_HOME_DIR = user;
	process.env.HOST_CLIENT_ID = "butler-fixture";
	process.env.NODE_ENV = "test";
	const { createApp } = await import("../app"),
		{ PskHostAuthProvider } = await import("../providers/host-auth");
	let host: CreateAppResult | undefined,
		http: ReturnType<typeof serve> | undefined,
		endpoint = "";
	let client: ReturnType<typeof createTRPCClient<AppRouter>>;
	const key = "isolated-butler-" + randomUUID(),
		token = randomUUID();
	let requests = 0;
	const responses: Array<(body: any) => Response | Promise<Response>> = [];
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
					credentialRemedy: () => "No external fixture credentials",
				},
			},
			memory: {
				home: () => home,
				transcriptHome: () => user,
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
						assert.equal(body.max_tokens, 1500);
						assert.ok(body.tools.length > 0);
						const response = responses.shift();
						assert.ok(response, "No unplanned model calls");
						return response(body);
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
					url: endpoint + "/trpc",
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
		const { stdout } = await run(
			"bun",
			["run", "dev", "butler", ...args, "--json"],
			{
				cwd: join(repo, "packages/cli"),
				env: { ...process.env, CI: "1" },
				maxBuffer: 4e6,
			},
		);
		return JSON.parse(stdout);
	}
	try {
		await run("git", ["init", "-b", "main", project]);
		writeFileSync(join(project, "README.md"), "preserve user's project\n");
		await run("git", ["-C", project, "add", "."]);
		await run("git", [
			"-C",
			project,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@invalid",
			"commit",
			"-qm",
			"fixture",
		]);
		await boot();
		assert.ok(host);
		const noKey = await cli([
			"ask",
			"--message",
			"No key check",
			"--request-id",
			"no-key",
		]);
		assert.equal(noKey.reason, "no_key");
		assert.equal(requests, 0);
		assert.ok((await cli(["list"])).length > 0);
		const p = randomUUID(),
			w = randomUUID(),
			archive = randomUUID(),
			team = randomUUID(),
			member = randomUUID(),
			terminal = randomUUID();
		host.db
			.insert(projects)
			.values({ id: p, name: "Fixture", repoPath: project })
			.run();
		for (const id of [w, archive])
			host.db
				.insert(workspaces)
				.values({
					id,
					projectId: p,
					name: id === w ? "Live" : "Archive target",
					worktreePath: project,
					type: "local",
					branch: "main",
				})
				.run();
		host.db
			.insert(teams)
			.values({
				id: team,
				name: "Old team name",
				goal: "",
				status: "paused",
				originWorkspaceId: w,
				createdAt: 1,
				updatedAt: 1,
			})
			.run();
		host.db
			.insert(terminalSessions)
			.values({ id: terminal, originWorkspaceId: w })
			.run();
		host.terminalAgentStore.recordEvent({
			terminalId: terminal,
			workspaceId: w,
			agentId: "claude",
			agentSessionId: "leader-session",
			launchId: "leader-launch",
			eventType: "Attached",
			occurredAt: 1,
		});
		host.db
			.insert(teamMembers)
			.values({
				id: member,
				teamId: team,
				name: "leader",
				role: "leader",
				status: "active",
				operationId: member,
				requestFingerprint: member,
				requestJson: "{}",
				workspaceId: w,
				terminalId: terminal,
				agentId: "claude",
				expectedLaunchId: "leader-launch",
				boundStartedAt: 1,
				boundAgentSessionId: "leader-session",
				taskSummary: "Leader",
				joinedAt: 1,
			})
			.run();
		await client!.aiSettings.setDeepseekKey.mutate({ apiKey: key });
		assert.equal(
			statSync(join(home, "secrets/deepseek.key")).mode & 0o777,
			0o600,
		);
		const human =
			"  请保留原话\nRename the team, then ask the Leader for an update.  ";
		responses.push(
			() =>
				toolResponse("renameTeam", {
					teamId: team,
					name: "Renamed through Butler",
				}),
			() =>
				toolResponse(
					"sendMailToLeader",
					{
						teamId: team,
						body: "Please provide an update",
						subject: "Progress",
					},
					"mail-call",
				),
			async (body) => {
				const row = host!.db
					.select()
					.from(mailEvents)
					.all()
					.find((row) => row.type === "butler.message");
				assert.ok(row);
				assert.equal(JSON.parse(row.payloadJson ?? "{}").humanVerbatim, human);
				assert.ok(
					body.messages.some(
						(m: any) => m.role === "tool" && m.tool_call_id === "mail-call",
					),
				);
				await client!.mail.send.mutate({
					teamId: team,
					to: "leader",
					actor: { workspaceId: w, terminalId: terminal },
					body: "Leader confirms the backend is ready",
					subject: "Reply",
					type: "agent.message",
					replyTo: row.id,
					dedupeKey: "leader-reply",
				});
				return toolResponse("getMail", { teamId: team }, "read-mail");
			},
			(body) => {
				assert.ok(
					body.messages.some(
						(m: any) =>
							m.role === "tool" &&
							m.content.includes("Leader confirms the backend is ready"),
					),
				);
				return finalResponse("Leader confirms the backend is ready.");
			},
		);
		const result = await cli([
			"ask",
			"--message",
			human,
			"--request-id",
			"mail-turn",
		]);
		assert.equal(result.degraded, false);
		assert.equal(result.threadId, noKey.threadId);
		assert.match(result.reply, /backend is ready/);
		assert.equal(
			host.db.select().from(teams).where(eq(teams.id, team)).get()?.name,
			"Renamed through Butler",
		);
		assert.equal(
			(await cli(["history", "--thread", result.threadId])).find(
				(message: { requestId: string; role: string }) =>
					message.requestId === result.requestId && message.role === "human",
			)?.content,
			human,
		);
		const before = requests;
		assert.equal(
			(await cli(["ask", "--message", human, "--request-id", "mail-turn"]))
				.requestId,
			result.requestId,
		);
		assert.equal(requests, before);
		responses.push(
			() =>
				toolResponse("requestApproval", {
					actionType: "archiveWorkspace",
					workspaceId: archive,
				}),
			() => finalResponse("Archive requires your approval."),
		);
		const proposed = await client!.butler.sendMessage.mutate({
			threadId: result.threadId,
			humanText: "Archive the selected Workspace",
			requestId: "archive-turn",
		});
		const card = proposed.approvals[0]!;
		assert.equal(
			host.db.select().from(workspaces).where(eq(workspaces.id, archive)).get()
				?.archivedAt,
			null,
		);
		assert.equal((await cli(["approvals"])).length, 1);
		const approved = await cli([
			"resolve",
			"--approval",
			card.id,
			"--payload-hash",
			card.payloadHash,
			"--decision",
			"approve",
		]);
		assert.equal(approved.status, "executed");
		assert.ok(
			host.db.select().from(workspaces).where(eq(workspaces.id, archive)).get()
				?.archivedAt,
		);
		assert.ok(existsSync(join(project, "README.md")));
		await assert.rejects(
			client!.butler.resolveApproval.mutate({
				approvalId: card.id,
				payloadHash: card.payloadHash,
				decision: "approve",
			}),
		);
		responses.push(
			() =>
				toolResponse("requestApproval", {
					actionType: "stopTeam",
					teamId: team,
				}),
			() => finalResponse("Stop Team requires approval."),
		);
		const stop = await client!.butler.sendMessage.mutate({
			threadId: result.threadId,
			humanText: "Stop the Team",
			requestId: "stop-turn",
		});
		const stopCard = stop.approvals[0]!;
		assert.equal(
			host.db.select().from(teams).where(eq(teams.id, team)).get()?.status,
			"paused",
		);
		const stopResult = await client!.butler.resolveApproval.mutate({
			approvalId: stopCard.id,
			payloadHash: stopCard.payloadHash,
			decision: "approve",
		});
		assert.equal(stopResult.status, "executed");
		assert.equal(
			host.db.select().from(teams).where(eq(teams.id, team)).get()?.status,
			"stopped",
		);
		const headers = { Authorization: `Bearer ${token}` };
		assert.equal(
			(await fetch(endpoint + "/api/v1/butler/threads")).status,
			401,
		);
		const openapi = (await (
			await fetch(endpoint + "/api/v1/openapi.json", { headers })
		).json()) as any;
		assert.ok(openapi.paths["/api/v1/butler/messages"].post);
		assert.ok(openapi.paths["/api/v1/memory"].get);
		assert.ok(openapi.paths["/api/v1/mail"]);
		assert.equal(
			(
				await fetch(
					endpoint + "/api/v1/butler/history?threadId=" + result.threadId,
					{ headers },
				)
			).status,
			200,
		);
		await close();
		await boot();
		const saved = await cli(["history", "--thread", result.threadId]);
		assert.equal(saved[0].requestId, noKey.requestId);
		assert.equal(saved[0].content, "No key check");
		assert.equal(
			saved.find(
				(message: { requestId: string; role: string }) =>
					message.requestId === result.requestId && message.role === "human",
			)?.content,
			human,
		);
		assert.ok(saved.some((m: any) => m.content.includes("backend is ready")));
		assert.ok(
			(await client!.butler.listApprovals.query({ status: "history" })).some(
				(card) => card.status === "executed",
			),
		);
		await client!.aiSettings.setDeepseekKey.mutate({ apiKey: null });
		const fallback = await client!.butler.sendMessage.mutate({
			threadId: result.threadId,
			humanText: "No key again",
		});
		assert.equal(fallback.reason, "no_key");
		assert.equal(requests, 8);
		assert.equal(responses.length, 0);
		console.log(
			"M4 real Host/CLI evidence",
			JSON.stringify({
				node: process.versions.node,
				abi: process.versions.modules,
				fakeRequests: requests,
				root,
				coverage:
					"native-loop/verbatim/Leader-reply/rename/archive/stop/approval/replay/persistence/no-key/auth/OpenAPI/CLI",
			}),
		);
	} finally {
		await close();
		rmSync(root, { recursive: true, force: true });
	}
});
