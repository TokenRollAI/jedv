import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getTemplatePath } from "./config";
import { getNotifyScriptContent } from "./notify-hook";

type Packet = { eventType: string; deliverySequence?: number };
type Handler = (...args: unknown[]) => unknown;
type Producer = "amp" | "pi" | "omp" | "opencode" | "opencode-tui";
const flags = globalThis as typeof globalThis & {
	__jedvAmpLifecyclePluginV1?: boolean;
	__jedvOpencodeNotifyPluginV11?: boolean;
};
async function fixture(
	kind: Producer,
	failAllocation = false,
	lookupGate?: Promise<void>,
) {
	const root = mkdtempSync(join(tmpdir(), "jedv-producer-order-"));
	const hooks = join(root, "hooks");
	mkdirSync(hooks);
	const real = join(hooks, "actual-notify.sh"),
		notify = join(hooks, "notify.sh"),
		gate = join(root, "stop-gate");
	writeFileSync(real, getNotifyScriptContent());
	expect(spawnSync("mkfifo", [gate]).status).toBe(0);
	writeFileSync(
		notify,
		`#!/bin/bash
if [ "$1" = "--allocate-delivery-sequence" ]; then
  ${failAllocation ? "exit 1" : 'exec bash "$PRODUCER_REAL_NOTIFY" "$1"'}
fi
if [ -n "$1" ]; then INPUT="$1"; else INPUT=$(cat); fi
case "$INPUT" in *Stop*) read -r RELEASE < "$PRODUCER_STOP_GATE" ;; esac
exec bash "$PRODUCER_REAL_NOTIFY" "$INPUT" "\${2-}"
`,
		{ mode: 0o755 },
	);
	const received: Packet[] = [];
	const waiters: Array<{ predicate: () => boolean; resolve: () => void }> = [];
	const wait = (predicate: () => boolean) =>
		predicate()
			? Promise.resolve()
			: new Promise<void>((resolve) => waiters.push({ predicate, resolve }));
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			received.push(((await request.json()) as { json: Packet }).json);
			for (const waiter of waiters) if (waiter.predicate()) waiter.resolve();
			return Response.json({
				result: { data: { json: { success: true, ignored: false } } },
			});
		},
	});
	const saved = { ...process.env };
	for (const key of Object.keys(process.env))
		if (key.startsWith("JEDV_")) delete process.env[key];
	Object.assign(process.env, {
		JEDV_HOME_DIR: root,
		JEDV_TERMINAL_ID: "terminal",
		JEDV_AGENT_LAUNCH_ID: "launch",
		JEDV_AGENT_ID: kind.startsWith("opencode") ? "opencode" : kind,
		JEDV_HOST_AGENT_HOOK_URL: `http://127.0.0.1:${server.port}/hook`,
		PRODUCER_STOP_GATE: gate,
		PRODUCER_REAL_NOTIFY: real,
	});
	const env = { ...process.env };
	const source =
		kind === "amp"
			? "amp-plugin.template.ts"
			: kind === "pi"
				? "pi-extension.template.ts"
				: kind === "omp"
					? "omp-extension.template.ts"
					: kind === "opencode"
						? "opencode-plugin.template.js"
						: "opencode-tui-plugin.template.js";
	let rendered = readFileSync(getTemplatePath(source), "utf8")
		.replaceAll("{{MARKER}}", "// isolated producer test")
		.replaceAll("{{APP_HOME_DIR_NAME}}", ".jedv");
	rendered = rendered.replace(
		"{{NOTIFY_PATH}}",
		kind === "opencode-tui" ? JSON.stringify(notify) : notify,
	);
	const pluginPath = join(
		root,
		source.endsWith(".ts") ? "plugin.ts" : "plugin.mjs",
	);
	writeFileSync(pluginPath, rendered);
	const plugin = await import(pathToFileURL(pluginPath).href);
	const handlers = new Map<string, Handler>();
	const getHandler = (name: string) => {
		const handler = handlers.get(name);
		if (!handler) throw new Error(`Missing native handler: ${name}`);
		return handler;
	};
	let close: (() => unknown) | undefined;
	let fire: (state: "start" | "stop") => unknown;
	if (kind === "amp") {
		delete flags.__jedvAmpLifecyclePluginV1;
		plugin.default({
			on: (name: string, handler: Handler) => handlers.set(name, handler),
		});
		fire = (state) =>
			getHandler(state === "start" ? "agent.start" : "agent.end")({
				threadId: "session",
			});
	} else if (kind === "pi" || kind === "omp") {
		plugin.default({
			on: (name: string, handler: Handler) => handlers.set(name, handler),
		});
		fire = (state) =>
			getHandler(
				state === "start"
					? kind === "pi"
						? "before_agent_start"
						: "agent_start"
					: "agent_end",
			)({}, { hasUI: true });
	} else if (kind === "opencode") {
		delete flags.__jedvOpencodeNotifyPluginV11;
		const hooks = await plugin.JedvNotifyPlugin({
			client: {
				session: {
					list: async () => {
						await lookupGate;
						return { data: [{ id: "session" }] };
					},
				},
			},
			$: (
				_parts: TemplateStringsArray,
				path: string,
				payload: string,
				sequence: string,
			) => {
				const child = Bun.spawn(["bash", path, payload, sequence], {
					env: {
						...env,
						JEDV_HOOK_HARNESS: "opencode",
						JEDV_HOOK_SEQUENCE_ALLOCATED: "1",
						JEDV_HOOK_DELIVERY_SEQUENCE: "",
					},
					stdin: "ignore",
					stdout: "ignore",
					stderr: "ignore",
				});
				return child.exited;
			},
		});
		fire = (state) =>
			hooks.event({
				event: {
					type: "session.status",
					properties: {
						sessionID: "session",
						status: { type: state === "start" ? "busy" : "idle" },
					},
				},
			});
	} else {
		close = plugin.default.setup({
			options: { routePollMs: 3600000 },
			data: {
				on: (name: string, handler: Handler) => {
					handlers.set(name, handler);
					return () => handlers.delete(name);
				},
				session: {
					root: (id: string) => id,
					get: () => ({}),
					status: () => "idle",
				},
			},
			ui: {
				router: { current: () => ({ type: "session", sessionID: "session" }) },
			},
		});
		fire = (state) =>
			getHandler(
				state === "start"
					? "session.execution.started"
					: "session.execution.succeeded",
			)({ data: { sessionID: "session" } });
	}
	return {
		root,
		notify,
		real,
		received,
		fire,
		wait,
		env,
		gate,
		counter: join(root, "state/hook-sequences/terminal.launch"),
		release: () => writeFile(gate, "release\n"),
		async dispose() {
			await close?.();
			server.stop(true);
			for (const key of Object.keys(process.env))
				if (!(key in saved)) delete process.env[key];
			Object.assign(process.env, saved);
			delete flags.__jedvAmpLifecyclePluginV1;
			delete flags.__jedvOpencodeNotifyPluginV11;
			rmSync(root, { recursive: true, force: true });
		},
	};
}
for (const kind of ["amp", "pi", "omp", "opencode", "opencode-tui"] as const) {
	test(`${kind} reserves at event occurrence and a delayed old Stop cannot outrank the next Start`, async () => {
		const f = await fixture(kind);
		try {
			await f.fire("start");
			await f.wait(() => f.received.length === 1);
			await f.fire("stop");
			await f.fire("start");
			expect(readFileSync(f.counter, "utf8").trim()).toBe("3");
			// This request must arrive while the old Stop sender is still gated.
			await f.wait(() => f.received.some((p) => p.deliverySequence === 3));
			await f.release();
			await f.wait(() => f.received.length === 3);
			expect(f.received.map((p) => [p.eventType, p.deliverySequence])).toEqual([
				["Start", 1],
				["Start", 3],
				["Stop", 2],
			]);
		} finally {
			await f.dispose();
		}
	});
	test(`${kind} never lets the detached sender allocate after foreground reservation failed`, async () => {
		const f = await fixture(kind, true);
		try {
			await f.fire("start");
			await f.wait(() => f.received.length === 1);
			await f.fire("stop");
			const parent = join(f.root, "state/hook-sequences");
			mkdirSync(parent, { recursive: true });
			writeFileSync(f.counter, "40\n");
			await f.release();
			await f.wait(() => f.received.length === 2);
			expect(f.received.every((p) => p.deliverySequence === undefined)).toBe(
				true,
			);
			expect(readFileSync(f.counter, "utf8").trim()).toBe("40");
		} finally {
			await f.dispose();
		}
	});
}

test("OpenCode reserves before an asynchronous root lookup or the event queue can reorder occurrence", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const f = await fixture("opencode", false, gate);
	try {
		const jobs = [f.fire("start"), f.fire("stop"), f.fire("start")];
		expect(readFileSync(f.counter, "utf8").trim()).toBe("3");
		release();
		await Promise.all(jobs);
		await f.wait(() => f.received.some((p) => p.deliverySequence === 3));
		await f.release();
		await f.wait(() => f.received.length === 3);
		expect(
			[...f.received]
				.sort((a, b) => Number(a.deliverySequence) - Number(b.deliverySequence))
				.map((p) => [p.eventType, p.deliverySequence]),
		).toEqual([
			["Start", 1],
			["Stop", 2],
			["Start", 3],
		]);
	} finally {
		release();
		await f.dispose();
	}
});
