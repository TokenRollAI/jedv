import { afterEach, expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createMacosDaemonPlist,
	findMacosDaemonJob,
	isMacosDaemonJob,
	launchMacosDaemon,
	type MacosLaunchDeps,
	type MacosLaunchOptions,
	recordMacosDaemonHandoff,
	recordMacosDaemonPid,
	releaseMacosDaemonJob,
} from "./macos-launch";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "jedv-launch-plan-"));
	roots.push(directory);
	const options: MacosLaunchOptions = {
		directory,
		socketPath: join(directory, "pty.sock"),
		executable: "/Applications/Jedv & Test.app/Contents/MacOS/Jedv",
		scriptPath: "/a path/host's " + '"script".js',
		bufferBytes: 1024,
		logPath: join(directory, "daemon.log"),
		uid: 501,
		env: {
			HOME: "/Users/fixture",
			PATH: "/bin:/test path",
			JEDV_HOME_DIR: directory,
			JEDV_TERMINAL_ID: "must-not-leak",
			JEDV_TEAM_ID: "must-not-leak",
			HOST_SERVICE_SECRET: "must-not-leak",
			ANTHROPIC_API_KEY: "must-not-leak",
		},
	};
	const commands: string[][] = [];
	const live = new Set<number>();
	let socketLive = false;
	const deps: MacosLaunchDeps = {
		run: async (args) => {
			commands.push(args);
			return {
				code: 0,
				stdout: args[0] === "kickstart" ? "12345\n" : "",
				stderr: "",
			};
		},
		isAlive: (pid) => live.has(pid),
		isSocketLive: async () => socketLive,
		generation: () => "a".repeat(32),
	};
	return {
		options,
		deps,
		commands,
		live,
		socket: (value: boolean) => {
			socketLive = value;
		},
	};
}

test("launch plans isolate app responsibility without leaking launch or credential environment", async () => {
	const f = fixture();
	const started = await launchMacosDaemon(f.options, f.deps);
	expect(f.commands.map((args) => args[0])).toEqual(["bootstrap", "kickstart"]);
	expect(f.commands[1]).toEqual([
		"kickstart",
		"-p",
		`gui/501/${started.job.label}`,
	]);
	expect(started.pid).toBe(12345);
	expect(statSync(started.job.plistPath).mode & 0o777).toBe(0o600);
	const plist = readFileSync(started.job.plistPath, "utf8");
	expect(plist).toContain("Jedv &amp; Test.app");
	expect(plist).toContain("host&apos;s &quot;script&quot;.js");
	expect(plist).toContain("<key>KeepAlive</key><false/>");
	expect(plist).toContain("<key>RunAtLoad</key><false/>");
	expect(plist).toContain("<key>AbandonProcessGroup</key><true/>");
	expect(plist).not.toContain("must-not-leak");
	expect(plist).not.toContain("/bin/sh");
	expect(findMacosDaemonJob(f.options.directory, 501, 12345)).toEqual(
		started.job,
	);
});

test("a second Host cannot create another generation while the first launch is unconfirmed", async () => {
	const f = fixture();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const first = launchMacosDaemon(f.options, {
		...f.deps,
		run: async (args) => {
			if (args[0] === "bootstrap") await gate;
			return f.deps.run(args);
		},
	});
	await expect(launchMacosDaemon(f.options, f.deps)).rejects.toThrow(
		"unconfirmed",
	);
	release();
	await first;
	expect(f.commands.filter((args) => args[0] === "bootstrap")).toHaveLength(1);
});

test("unknown bootstrap results stay bounded and never retry under another label", async () => {
	const f = fixture();
	await expect(
		launchMacosDaemon(f.options, {
			...f.deps,
			run: async () => {
				throw new Error("transport timeout");
			},
		}),
	).rejects.toThrow("transport timeout");
	await expect(launchMacosDaemon(f.options, f.deps)).rejects.toThrow(
		"reconcile",
	);
	expect(f.commands).toHaveLength(0);
});

test("a confirmed bootstrap rejection cleans only its never-started job and never switches domains", async () => {
	const f = fixture();
	const calls: string[][] = [];
	await expect(
		launchMacosDaemon(f.options, {
			...f.deps,
			run: async (args) => {
				calls.push(args);
				return {
					code: args[0] === "bootstrap" ? 5 : 3,
					stdout: "",
					stderr: "fixture",
				};
			},
		}),
	).rejects.toThrow("registration failed");
	expect(calls.map((args) => args[0])).toEqual(["bootstrap", "bootout"]);
	expect(calls.every((args) => args[1]?.startsWith("gui/501"))).toBe(true);
	expect(findMacosDaemonJob(f.options.directory, 501, 12345)).toBeUndefined();
});

test("cleanup preserves a live daemon and a live handoff successor", async () => {
	const f = fixture();
	const { job, pid } = await launchMacosDaemon(f.options, f.deps);
	f.live.add(pid);
	expect(await releaseMacosDaemonJob(f.options, job, pid, f.deps)).toBe(false);
	f.live.delete(pid);
	f.socket(true);
	expect(await releaseMacosDaemonJob(f.options, job, pid, f.deps)).toBe(false);
	expect(recordMacosDaemonPid(f.options.directory, job, pid, 23456)).toBe(true);
	f.socket(false);
	expect(await releaseMacosDaemonJob(f.options, job, pid, f.deps)).toBe(false);
	expect(f.commands.some((args) => args[0] === "bootout")).toBe(false);
	expect(findMacosDaemonJob(f.options.directory, 501, 23456)).toEqual(job);
});

test("cleanup rechecks generation and process identity after its asynchronous probe", async () => {
	const f = fixture();
	const { job, pid } = await launchMacosDaemon(f.options, f.deps);
	const cleaned = await releaseMacosDaemonJob(f.options, job, pid, {
		...f.deps,
		isSocketLive: async () => {
			recordMacosDaemonPid(f.options.directory, job, pid, 23456);
			return false;
		},
	});
	expect(cleaned).toBe(false);
	expect(f.commands.some((args) => args[0] === "bootout")).toBe(false);
});

test("a handoff gap with a dead predecessor and no bound socket cannot unload the job", async () => {
	const f = fixture();
	const { job, pid } = await launchMacosDaemon(f.options, f.deps);
	expect(recordMacosDaemonHandoff(f.options.directory, job, pid, true)).toBe(
		true,
	);
	expect(recordMacosDaemonHandoff(f.options.directory, job, pid, true)).toBe(
		false,
	);
	expect(await releaseMacosDaemonJob(f.options, job, pid, f.deps)).toBe(false);
	await expect(launchMacosDaemon(f.options, f.deps)).rejects.toThrow(
		"unconfirmed",
	);
	expect(f.commands.some((args) => args[0] === "bootout")).toBe(false);
	expect(recordMacosDaemonPid(f.options.directory, job, pid, 23456)).toBe(true);
	expect(await releaseMacosDaemonJob(f.options, job, 23456, f.deps)).toBe(true);
});

test("only the same profile and user may unload a confirmed-dead generation", async () => {
	const f = fixture();
	const { job, pid } = await launchMacosDaemon(f.options, f.deps);
	expect(isMacosDaemonJob(job, `${f.options.directory}-other`, 501)).toBe(
		false,
	);
	expect(isMacosDaemonJob(job, f.options.directory, 502)).toBe(false);
	expect(
		await releaseMacosDaemonJob(
			f.options,
			{ ...job, plistPath: "/tmp/other.plist" },
			pid,
			f.deps,
		),
	).toBe(false);
	expect(await releaseMacosDaemonJob(f.options, job, pid, f.deps)).toBe(true);
	expect(f.commands.at(-1)).toEqual(["bootout", `gui/501/${job.label}`]);
	expect(findMacosDaemonJob(f.options.directory, 501, pid)).toBeUndefined();
});

test("a failed unload retains ownership evidence instead of claiming successful cleanup", async () => {
	const f = fixture();
	const { job, pid } = await launchMacosDaemon(f.options, f.deps);
	expect(
		await releaseMacosDaemonJob(f.options, job, pid, {
			...f.deps,
			run: async () => ({ code: 5, stdout: "", stderr: "failed" }),
		}),
	).toBe(false);
	expect(findMacosDaemonJob(f.options.directory, 501, pid)).toEqual(job);
});

test("logout-removed jobs can release their dead generation without leaking a new label", async () => {
	const f = fixture();
	const { job, pid } = await launchMacosDaemon(f.options, f.deps);
	expect(
		await releaseMacosDaemonJob(f.options, job, pid, {
			...f.deps,
			run: async () => ({ code: 3, stdout: "", stderr: "No such process" }),
		}),
	).toBe(true);
	expect(findMacosDaemonJob(f.options.directory, 501, pid)).toBeUndefined();
});

test("a corrupt ownership record fails closed before touching launchd", async () => {
	const f = fixture();
	writeFileSync(join(f.options.directory, "pty-daemon-launchd.json"), "{torn");
	await expect(launchMacosDaemon(f.options, f.deps)).rejects.toThrow();
	expect(f.commands).toHaveLength(0);
});

test("invalid plist control characters fail before claiming a generation", () => {
	const f = fixture();
	expect(() =>
		createMacosDaemonPlist(
			{ ...f.options, executable: "/bad\0path" },
			{
				label: "fixture",
				generation: "a".repeat(32),
				plistPath: "/unused",
				uid: 501,
				domain: "user",
			},
		),
	).toThrow("control characters");
});
