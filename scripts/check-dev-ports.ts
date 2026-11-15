#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function repoRoot(): string {
	try {
		return execFileSync("git", ["rev-parse", "--show-toplevel"], {
			encoding: "utf-8",
		}).trim();
	} catch {
		return process.cwd();
	}
}

const root = repoRoot();

const PORT_VARS: Record<string, number> = {
	DESKTOP_VITE_PORT: 5173,
	DESKTOP_NOTIFICATIONS_PORT: 52741,
};

function readEnvPorts(): { name: string; port: number }[] {
	const envPath = join(root, ".env");
	const env: Record<string, string> = {};
	if (existsSync(envPath)) {
		for (const line of readFileSync(envPath, "utf-8").split("\n")) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]+)"?/);
			if (m) env[m[1] as string] = (m[2] as string).trim();
		}
	}
	return Object.entries(PORT_VARS).map(([name, fallback]) => ({
		name,
		port: Number(env[name] ?? process.env[name] ?? fallback),
	}));
}

function listenerPids(port: number): number[] {
	try {
		return execFileSync(
			"lsof",
			["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
			{ encoding: "utf-8" },
		)
			.split("\n")
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isFinite(n) && n > 0);
	} catch {
		return []; // lsof exits non-zero when nothing is listening
	}
}

function commandOf(pid: number): string {
	try {
		return execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
			encoding: "utf-8",
		}).trim();
	} catch {
		return "";
	}
}

const held = readEnvPorts()
	.map(({ name, port }) => ({ name, port, pids: listenerPids(port) }))
	.filter((p) => p.pids.length > 0);

if (held.length === 0) process.exit(0);

const foreign: { name: string; port: number; pid: number; cmd: string }[] = [];
const freedOurs: number[] = [];

for (const { name, port, pids } of held) {
	for (const pid of pids) {
		const cmd = commandOf(pid);
		if (cmd.includes(root)) {
			// Stale leftover from this worktree — safe to reclaim.
			try {
				process.kill(pid, "SIGKILL");
				freedOurs.push(port);
			} catch {}
		} else {
			foreign.push({ name, port, pid, cmd });
		}
	}
}

if (freedOurs.length > 0) {
	console.error(
		`[check-dev-ports] freed stale ports from this worktree: ${[...new Set(freedOurs)].join(", ")}`,
	);
}

if (foreign.length > 0) {
	const worktrees = new Set(
		foreign.map((f) => {
			const m = f.cmd.match(/(\/.*?\/worktrees\/[^/]+\/[^/]+)/);
			return m ? m[1] : "another process";
		}),
	);
	console.error(
		"\n[check-dev-ports] Dev ports are in use by something outside this worktree:\n",
	);
	for (const f of foreign) {
		console.error(
			`  ${f.port} (${f.name})  pid ${f.pid}  ${f.cmd.slice(0, 80)}`,
		);
	}
	console.error(
		`\nLikely another dev stack running in: ${[...worktrees].join(", ")}\n` +
			"The whole repo shares fixed ports (JEDV_PORT_BASE=3960), so only one\n" +
			"dev:desktop stack can run at a time. Stop the other stack, or free these:\n\n" +
			`  kill -9 ${[...new Set(foreign.map((f) => f.pid))].join(" ")}\n`,
	);
	process.exit(1);
}

process.exit(0);
