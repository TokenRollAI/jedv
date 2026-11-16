import { expect, test } from "bun:test";
import {
	inspectNativeInterruptForeground,
	type NativeForegroundProcess,
	type NativeInterruptIdentityDependencies,
	parseNativeForegroundProcesses,
	parseNativeIdentityEnvironment,
} from "./native-interrupt-identity";

function fixture() {
	const processes: NativeForegroundProcess[] = [
		{
			pid: 100,
			ppid: 1,
			pgid: 100,
			foregroundPgid: 200,
			tty: "ttys004",
			startedAt: "shell-start",
		},
		{
			pid: 200,
			ppid: 100,
			pgid: 200,
			foregroundPgid: 200,
			tty: "ttys004",
			startedAt: "wrapper-start",
		},
		{
			pid: 201,
			ppid: 200,
			pgid: 200,
			foregroundPgid: 200,
			tty: "ttys004",
			startedAt: "codex-start",
		},
	];
	const environment = {
		JEDV_TERMINAL_ID: "terminal",
		JEDV_WORKSPACE_ID: "workspace",
		JEDV_AGENT_LAUNCH_ID: "launch",
		JEDV_AGENT_ID: "codex",
	};
	const input = {
		shellPid: 100,
		expectedExecutable: "/opt/bin/codex",
		expectedAgent: {
			terminalId: "terminal",
			workspaceId: "workspace",
			launchId: "launch",
			agentSessionId: "session",
			agentId: "codex" as const,
			startedAt: 1,
			lastEventAt: 2,
			lastEventType: "Start",
		},
	};
	const deps: NativeInterruptIdentityDependencies = {
		processes: async () => processes.map((row) => ({ ...row })),
		executable: async (pid) => (pid === 201 ? "/opt/bin/codex" : "/bin/bash"),
		environment: async () => environment,
		canonicalize: async (path) => path,
	};
	return { processes, environment, input, deps };
}

test("foreground proof requires exact executable, PTY lineage and current launch environment", async () => {
	const f = fixture();
	const proof = await inspectNativeInterruptForeground(f.input, f.deps);
	expect(proof?.pid).toBe(201);
	expect(await proof?.isCurrent()).toBe(true);
	const process = f.processes[2];
	if (!process) throw new Error("Missing fixture");
	process.startedAt = "reused-pid";
	expect(await proof?.isCurrent()).toBe(false);
});

test.each([
	"shell",
	"background",
	"other-executable",
	"other-tty",
	"outside-tree",
	"wrong-launch",
	"wrong-terminal",
	"wrong-workspace",
	"ambiguous",
	"unknown",
])("%s cannot authorize an interrupt key", async (change) => {
	const f = fixture();
	const shell = f.processes[0];
	const candidate = f.processes[2];
	if (!shell || !candidate) throw new Error("Missing fixture");
	if (change === "shell") shell.foregroundPgid = shell.pgid;
	if (change === "background") candidate.pgid = 300;
	if (change === "other-executable")
		f.deps.executable = async () => "/tmp/fake-codex";
	if (change === "other-tty") candidate.tty = "ttys999";
	if (change === "outside-tree") candidate.ppid = 1;
	if (change === "wrong-launch")
		f.environment.JEDV_AGENT_LAUNCH_ID = "other-launch";
	if (change === "wrong-terminal")
		f.environment.JEDV_TERMINAL_ID = "other-terminal";
	if (change === "wrong-workspace")
		f.environment.JEDV_WORKSPACE_ID = "other-workspace";
	if (change === "ambiguous") f.deps.executable = async () => "/opt/bin/codex";
	if (change === "unknown") f.deps.processes = async () => null;
	expect(await inspectNativeInterruptForeground(f.input, f.deps)).toBeNull();
});

test("process replacement while reading its environment invalidates the proof", async () => {
	const f = fixture();
	let reads = 0;
	f.deps.environment = async () => {
		if (++reads === 1 && f.processes[2])
			f.processes[2].startedAt = "replacement";
		return f.environment;
	};
	expect(await inspectNativeInterruptForeground(f.input, f.deps)).toBeNull();
});

test("process inspection errors fail closed without echoing sensitive command output", async () => {
	const f = fixture();
	f.deps.environment = async () => {
		throw new Error("private environment");
	};
	expect(await inspectNativeInterruptForeground(f.input, f.deps)).toBeNull();
});

test("process table parsing preserves process-start identity and absence of a controlling TTY", () => {
	expect(
		parseNativeForegroundProcesses(
			" 100 1 100 200 ttys004 Sun Nov 15 16:30:00 2026\n 2 1 2 -1 ?? Sun Nov 15 12:00:00 2026",
		),
	).toEqual([
		{
			pid: 100,
			ppid: 1,
			pgid: 100,
			foregroundPgid: 200,
			tty: "ttys004",
			startedAt: "Sun Nov 15 16:30:00 2026",
		},
		{
			pid: 2,
			ppid: 1,
			pgid: 2,
			foregroundPgid: -1,
			tty: null,
			startedAt: "Sun Nov 15 12:00:00 2026",
		},
	]);
});

test("identity environment parsing ignores other values and rejects duplicate fields", () => {
	expect(
		parseNativeIdentityEnvironment([
			"SECRET=private",
			"JEDV_TERMINAL_ID=terminal",
			"NOT_JEDV_TERMINAL_ID=fake",
		]),
	).toEqual({ JEDV_TERMINAL_ID: "terminal" });
	expect(
		parseNativeIdentityEnvironment([
			"JEDV_TERMINAL_ID=terminal",
			"JEDV_TERMINAL_ID=spoofed",
		]),
	).toBeNull();
});
