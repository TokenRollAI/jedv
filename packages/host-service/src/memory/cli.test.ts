import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { HostServiceContext } from "../types";
import { memoryApiRouter } from "./api";
import { MemoryRuntime, registerMemoryRuntime } from "./runtime";
import { memoryFixture } from "./test-fixture";

test("source memory CLI performs CRUD, review and JSON dedupe through isolated loopback tRPC", async () => {
	const f = memoryFixture();
	const owner = {};
	const runtime = new MemoryRuntime({
		db: f.db,
		home: () => f.root,
		memory: { projectRoot: () => f.root, isTeamArchived: () => false },
		watchdog: {
			snapshot: () => ({ members: [], mail: [], automationRuns: [] }),
		},
	});
	const unregister = registerMemoryRuntime(owner, runtime);
	const token = crypto.randomUUID();
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (req) =>
			fetchRequestHandler({
				endpoint: "/trpc",
				req,
				router: memoryApiRouter,
				createContext: () =>
					({
						runtime: owner,
						isAuthenticated:
							req.headers.get("authorization") === `Bearer ${token}`,
					}) as unknown as HostServiceContext,
			}),
	});
	try {
		const manifestDir = join(f.root, "host/jedv-local");
		mkdirSync(manifestDir, { recursive: true });
		writeFileSync(
			join(manifestDir, "manifest.json"),
			JSON.stringify({
				pid: process.pid,
				endpoint: `http://127.0.0.1:${server.port}`,
				authToken: token,
				startedAt: Date.now(),
				organizationId: "jedv-local",
			}),
			{ mode: 0o600 },
		);
		async function cli(...args: string[]) {
			const child = Bun.spawn(
				[process.execPath, "run", "dev", "memory", ...args, "--json"],
				{
					cwd: resolve(import.meta.dir, "../../../cli"),
					env: {
						...process.env,
						JEDV_HOME_DIR: f.root,
						HOST_CLIENT_ID: "isolated-memory-test",
						JEDV_TEAM_ID: "",
						JEDV_PROJECT_ID: "",
						JEDV_WORKSPACE_ID: "",
						JEDV_TERMINAL_ID: "",
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect({ code, stderr }).toEqual({ code: 0, stderr: expect.any(String) });
			if (code !== 0) throw new Error(stderr);
			const result = JSON.parse(stdout);
			return result.data ?? result;
		}
		const put = await cli(
			"put",
			"--scope",
			"global",
			"--title",
			"中文 convention",
			"--content",
			"可信幂等投递",
		);
		expect(put.status).toBe("active");
		expect(await cli("search", "幂等", "--scope", "global")).toHaveLength(1);
		expect(await cli("list", "--scope", "global")).toHaveLength(1);
		const exported = await cli("export", "--scope", "global", "--stdout");
		const file = join(f.root, "transfer.json");
		writeFileSync(file, JSON.stringify(exported));
		await cli("import", "--scope", "global", "--file", file);
		expect(runtime.memory.list({ scopeKind: "global" })).toHaveLength(1);
		const candidate = runtime.memory.propose({
			scopeKind: "global",
			scopeId: "",
			title: "Review",
			content: "another fact",
			tier: "core",
			category: "context",
			sourceRef: "terminal",
		});
		await cli("review", candidate.id, "--action", "accept");
		expect(runtime.memory.get(candidate.id).status).toBe("active");
		await cli("delete", put.id);
		expect(runtime.memory.get(put.id).status).toBe("removed");
		const project = await cli(
			"put",
			"--scope",
			"project",
			"--project",
			"p1",
			"--content",
			"project fact",
		);
		expect(project.scopeId).toBe("p1");
		const out = await cli("export", "--scope", "project", "--project", "p1");
		expect(out.filePath).toBe(join(f.root, ".jedv/memory.json"));
		await cli(
			"import",
			"--scope",
			"project",
			"--project",
			"p1",
			"--file",
			".jedv/memory.json",
		);
		expect(
			runtime.memory.list({ scopeKind: "project", scopeId: "p1" }),
		).toHaveLength(1);
	} finally {
		server.stop(true);
		unregister();
		await runtime.dispose();
		await f.dispose();
	}
}, 15000);
