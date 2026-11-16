import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { constants } from "node:os";
import { join, resolve } from "node:path";

export interface MacosDaemonJob {
	label: string;
	generation: string;
	plistPath: string;
	uid: number;
	domain: "user" | "gui";
}

interface LaunchRecord extends MacosDaemonJob {
	pid: number | null;
	handoffPending?: boolean;
}

export interface MacosLaunchOptions {
	directory: string;
	socketPath: string;
	executable: string;
	scriptPath: string;
	bufferBytes: number;
	logPath: string;
	env: NodeJS.ProcessEnv;
	uid: number;
	domain?: "user" | "gui";
}

export interface LaunchctlResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface MacosLaunchDeps {
	run: (args: string[]) => Promise<LaunchctlResult>;
	isAlive: (pid: number) => boolean;
	/** A successful connection is enough to prevent destructive cleanup. */
	isSocketLive: (socketPath: string) => Promise<boolean>;
	generation?: () => string;
}

const RECORD_NAME = "pty-daemon-launchd.json";
const LABEL_PREFIX = "dev.jedv.pty.";
const GENERATION = /^[0-9a-f]{32}$/;
const ENV_KEYS = [
	"HOME",
	"PATH",
	"SHELL",
	"TMPDIR",
	"LANG",
	"LC_ALL",
	"ELECTRON_RUN_AS_NODE",
	"NODE_OPTIONS",
	"JEDV_HOME_DIR",
	"JEDV_USER_HOME_DIR",
	"JEDV_PTY_DAEMON_VERSION",
	"ORGANIZATION_ID",
] as const;

function namespace(directory: string): string {
	return createHash("sha256")
		.update(resolve(directory))
		.digest("hex")
		.slice(0, 20);
}

function recordPath(directory: string): string {
	return join(directory, RECORD_NAME);
}

export function isMacosDaemonJob(
	value: unknown,
	directory: string,
	uid: number,
): value is MacosDaemonJob {
	if (!value || typeof value !== "object") return false;
	const job = value as Partial<MacosDaemonJob>;
	return (
		typeof job.generation === "string" &&
		GENERATION.test(job.generation) &&
		job.uid === uid &&
		(job.domain === "user" || job.domain === "gui") &&
		job.label === `${LABEL_PREFIX}${namespace(directory)}.${job.generation}` &&
		job.plistPath ===
			join(resolve(directory), `pty-daemon-${job.generation}.plist`)
	);
}

function xml(value: string): string {
	if (
		[...value].some((char) => {
			const code = char.charCodeAt(0);
			return code < 32 && code !== 9 && code !== 10 && code !== 13;
		})
	) {
		throw new Error("LaunchAgent values cannot contain XML control characters");
	}
	return value.replace(/[<>&"']/g, (char) => {
		return {
			"<": "&lt;",
			">": "&gt;",
			"&": "&amp;",
			'"': "&quot;",
			"'": "&apos;",
		}[char] as string;
	});
}

export function createMacosDaemonPlist(
	options: MacosLaunchOptions,
	job: MacosDaemonJob,
): string {
	const argv = [
		options.executable,
		options.scriptPath,
		`--socket=${options.socketPath}`,
		`--buffer-bytes=${options.bufferBytes}`,
		`--launchd-generation=${job.generation}`,
	];
	const environment = ENV_KEYS.flatMap((key) => {
		const value = options.env[key];
		return value === undefined
			? []
			: [`<key>${key}</key><string>${xml(value)}</string>`];
	}).join("");
	// The job is registered only in this login session, never installed in
	// Library/LaunchAgents. The supervisor remains the restart authority.
	// Handoff successors share their predecessor's process group, so launchd
	// must not kill that group when the predecessor exits after transferring FDs.
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(job.label)}</string>
<key>ProgramArguments</key><array>${argv.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>EnvironmentVariables</key><dict>${environment}</dict>
<key>RunAtLoad</key><false/>
<key>KeepAlive</key><false/>
<key>AbandonProcessGroup</key><true/>
<key>StandardOutPath</key><string>${xml(options.logPath)}</string>
<key>StandardErrorPath</key><string>${xml(options.logPath)}</string>
<key>SoftResourceLimits</key><dict><key>NumberOfFiles</key><integer>1048576</integer></dict>
</dict></plist>
`;
}

function readRecord(directory: string, uid: number): LaunchRecord | null {
	const file = recordPath(directory);
	if (!existsSync(file)) return null;
	const record: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (
		!isMacosDaemonJob(record, directory, uid) ||
		!("pid" in record) ||
		("handoffPending" in record &&
			typeof record.handoffPending !== "boolean") ||
		(record.pid !== null &&
			(typeof record.pid !== "number" ||
				!Number.isSafeInteger(record.pid) ||
				record.pid <= 1))
	) {
		throw new Error(
			"Invalid PTY LaunchAgent ownership record; reconcile before retrying",
		);
	}
	return record as LaunchRecord;
}

export function runLaunchctl(args: string[]): Promise<LaunchctlResult> {
	return new Promise((resolveResult, reject) => {
		execFile(
			"/bin/launchctl",
			args,
			{ encoding: "utf8", timeout: 5_000, maxBuffer: 64 * 1024 },
			(error, stdout, stderr) => {
				if (error && (error.killed || typeof error.code !== "number")) {
					reject(error);
					return;
				}
				resolveResult({
					code: typeof error?.code === "number" ? error.code : 0,
					stdout,
					stderr,
				});
			},
		);
	});
}

/** Remove only an exact, confirmed-dead generation. Never unload a live successor. */
export async function releaseMacosDaemonJob(
	options: Pick<MacosLaunchOptions, "directory" | "socketPath" | "uid">,
	job: MacosDaemonJob,
	pid: number,
	deps: MacosLaunchDeps,
): Promise<boolean> {
	if (!isMacosDaemonJob(job, options.directory, options.uid)) return false;
	const record = readRecord(options.directory, options.uid);
	if (
		!record ||
		record.generation !== job.generation ||
		record.pid !== pid ||
		record.handoffPending === true ||
		existsSync(`${job.plistPath}.handoff`) ||
		deps.isAlive(pid) ||
		(await deps.isSocketLive(options.socketPath))
	) {
		return false;
	}
	// Recheck the on-disk generation after the async probe. No code starts or
	// reuses a generation while this record still exists.
	const current = readRecord(options.directory, options.uid);
	if (
		current?.generation !== job.generation ||
		current.pid !== pid ||
		current.handoffPending === true ||
		existsSync(`${job.plistPath}.handoff`)
	)
		return false;
	const result = await deps.run([
		"bootout",
		`${job.domain}/${job.uid}/${job.label}`,
	]);
	// A job disappears at logout. ESRCH also makes repeated cleanup of this
	// exact confirmed-dead generation idempotent, without reading `print` output.
	if (result.code !== 0 && result.code !== constants.errno.ESRCH) return false;
	const after = readRecord(options.directory, options.uid);
	if (after?.generation !== job.generation || after.pid !== pid) return false;
	unlinkSync(recordPath(options.directory));
	if (existsSync(job.plistPath)) unlinkSync(job.plistPath);
	return true;
}

/** Update the same job's process identity after a successful FD handoff. */
export function recordMacosDaemonPid(
	directory: string,
	job: MacosDaemonJob,
	expectedPid: number | null,
	pid: number,
): boolean {
	if (!Number.isSafeInteger(pid) || pid <= 1) return false;
	if (!isMacosDaemonJob(job, directory, job.uid)) return false;
	const current = readRecord(directory, job.uid);
	if (current?.generation !== job.generation || current.pid !== expectedPid) {
		return false;
	}
	writeRecord(directory, { ...current, pid, handoffPending: false });
	if (existsSync(`${job.plistPath}.handoff`))
		unlinkSync(`${job.plistPath}.handoff`);
	return true;
}

function writeRecord(directory: string, record: LaunchRecord): void {
	const pending = `${recordPath(directory)}.${randomUUID()}.tmp`;
	try {
		writeFileSync(pending, JSON.stringify(record), {
			mode: 0o600,
			flag: "wx",
		});
		renameSync(pending, recordPath(directory));
	} finally {
		if (existsSync(pending)) unlinkSync(pending);
	}
}

/** Fence cleanup across the predecessor-exit/successor-bind gap, including other Hosts. */
export function recordMacosDaemonHandoff(
	directory: string,
	job: MacosDaemonJob,
	pid: number,
	pending: boolean,
): boolean {
	if (!isMacosDaemonJob(job, directory, job.uid)) return false;
	const current = readRecord(directory, job.uid);
	if (current?.generation !== job.generation || current.pid !== pid)
		return false;
	const claim = `${job.plistPath}.handoff`;
	if (pending) {
		try {
			writeFileSync(
				claim,
				JSON.stringify({ generation: job.generation, pid }),
				{
					flag: "wx",
					mode: 0o600,
				},
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
			throw error;
		}
		const claimed = readRecord(directory, job.uid);
		if (claimed?.generation !== job.generation || claimed.pid !== pid) {
			unlinkSync(claim);
			return false;
		}
	}
	writeRecord(directory, { ...current, handoffPending: pending });
	if (!pending && existsSync(claim)) unlinkSync(claim);
	return true;
}

/** Recover job identity only from this profile's exact generation record. */
export function findMacosDaemonJob(
	directory: string,
	uid: number,
	pid: number,
	observedGeneration?: string,
): MacosDaemonJob | undefined {
	const record = readRecord(directory, uid);
	if (!record) return undefined;
	if (
		observedGeneration !== undefined &&
		observedGeneration !== record.generation
	)
		return undefined;
	if (record.pid !== pid) {
		// A verified socket hello is the only authority for recovering a lost
		// kickstart reply or a Host crash during handoff. Legacy daemons cannot
		// supply this proof, so retain their unknown job instead of guessing.
		if (observedGeneration !== record.generation) return undefined;
		if (!recordMacosDaemonPid(directory, record, record.pid, pid))
			return undefined;
	}
	const { label, generation, plistPath, domain } = record;
	return { label, generation, plistPath, uid, domain };
}

export async function launchMacosDaemon(
	options: MacosLaunchOptions,
	deps: MacosLaunchDeps,
): Promise<{ pid: number; job: MacosDaemonJob }> {
	const directory = resolve(options.directory);
	if (!Number.isSafeInteger(options.uid) || options.uid < 0) {
		throw new Error("PTY LaunchAgent requires the current user's UID");
	}
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const existing = readRecord(directory, options.uid);
	if (existing) {
		if (
			existing.pid === null ||
			!(await releaseMacosDaemonJob(options, existing, existing.pid, deps))
		) {
			throw new Error(
				"A previous PTY LaunchAgent is active or unconfirmed; reconcile before retrying",
			);
		}
	}
	const generation = deps.generation?.() ?? randomUUID().replaceAll("-", "");
	if (!GENERATION.test(generation))
		throw new Error("Invalid launch generation");
	const job: MacosDaemonJob = {
		label: `${LABEL_PREFIX}${namespace(directory)}.${generation}`,
		generation,
		plistPath: join(directory, `pty-daemon-${generation}.plist`),
		uid: options.uid,
		domain: options.domain ?? "gui",
	};
	const plist = createMacosDaemonPlist(options, job);
	// Exclusive creation bounds this namespace to one unresolved generation;
	// a concurrent Host cannot create another job while this one is starting.
	writeFileSync(recordPath(directory), JSON.stringify({ ...job, pid: null }), {
		flag: "wx",
		mode: 0o600,
	});
	writeFileSync(job.plistPath, plist, { flag: "wx", mode: 0o600 });
	chmodSync(job.plistPath, 0o600);
	const bootstrap = await deps.run([
		"bootstrap",
		`${job.domain}/${job.uid}`,
		job.plistPath,
	]);
	if (bootstrap.code !== 0) {
		// RunAtLoad=false and no kickstart has been attempted: this exact
		// generation cannot yet own PTYs. A confirmed rejection may be cleaned
		// up; a transport timeout above remains deliberately unresolved.
		const cleanup = await deps.run([
			"bootout",
			`${job.domain}/${job.uid}/${job.label}`,
		]);
		if (cleanup.code === 0 || cleanup.code === constants.errno.ESRCH) {
			const current = readRecord(directory, job.uid);
			if (current?.generation === job.generation && current.pid === null) {
				unlinkSync(recordPath(directory));
				unlinkSync(job.plistPath);
			}
		}
		throw new Error(
			`PTY LaunchAgent registration failed (${bootstrap.code}); the macOS login-session service is unavailable`,
		);
	}
	const started = await deps.run([
		"kickstart",
		"-p",
		`${job.domain}/${job.uid}/${job.label}`,
	]);
	const pid = Number(started.stdout.trim());
	if (started.code !== 0 || !Number.isSafeInteger(pid) || pid <= 1) {
		throw new Error(
			"PTY LaunchAgent start was not confirmed; reconcile before retrying",
		);
	}
	if (!recordMacosDaemonPid(directory, job, null, pid)) {
		throw new Error("PTY LaunchAgent ownership changed during start");
	}
	return { pid, job };
}
