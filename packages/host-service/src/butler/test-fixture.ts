import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runMigrations } from "@jedv/shared/sqlite-migrations";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { DeepseekClient, type DeepseekDependencies } from "../ai/deepseek";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { createHostMemoryRuntime } from "../memory/host-runtime";
import { TerminalAgentStore } from "../terminal-agents/store";
import type { HostServiceContext } from "../types";
import { ButlerService } from "./service";
import { ButlerTools } from "./tools";
export function butlerFixture(fetcher?: DeepseekDependencies["fetch"]) {
	const root = mkdtempSync(join(tmpdir(), "jedv-butler-")),
		sqlite = new Database(":memory:");
	runMigrations(drizzle(sqlite), resolve(import.meta.dir, "../../drizzle"));
	const db = drizzle(sqlite, { schema }) as unknown as HostDb;
	let now = 1000000;
	const ctx = {
		db,
		runtime: {},
		terminalAgentStore: new TerminalAgentStore(),
		eventBus: {
			broadcastWorkspaceChanged: () => {},
			broadcastTeamChanged: () => {},
			onTerminalLifecycle: () => () => {},
		},
	} as unknown as HostServiceContext;
	const memory = createHostMemoryRuntime(ctx, { home: () => root });
	ctx.runtime.memory = memory.runtime;
	const ai = new DeepseekClient({
		readKey: () => (fetcher ? "isolated-butler-key" : null),
		fetch: fetcher,
	});
	const tools = new ButlerTools(ctx, () => now),
		service = new ButlerService({
			db: sqlite,
			ai,
			tools,
			now: () => now,
			watchdog: memory.runtime.watchdog,
		});
	return {
		root,
		sqlite,
		db,
		ctx,
		memory,
		ai,
		tools,
		service,
		advance: (ms: number) => {
			now += ms;
		},
		dispose: async () => {
			await service.dispose();
			await memory.dispose();
			sqlite.close();
			await rm(root, { recursive: true, force: true });
		},
	};
}
export const modelReply = (content: string) =>
	new Response(
		JSON.stringify({
			choices: [{ finish_reason: "stop", message: { content } }],
		}),
	);
export const modelTool = (name: string, args: unknown, id = "call1") =>
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
