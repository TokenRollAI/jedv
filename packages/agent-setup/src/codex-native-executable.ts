import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	mkdir,
	mkdtemp,
	open,
	realpath,
	rm,
	stat,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import {
	basename,
	delimiter,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { promisify } from "node:util";
import { buildCodexWrapperExecLine } from "./agent-wrappers-claude-codex-opencode";
import {
	buildDefaultAccountResolver,
	buildWrapperScript,
} from "./agent-wrappers-common";
import { getBinDir } from "./paths";

const execute = promisify(execFile);
// Audited installed npm launcher: optional platform package, then bundled
// vendor fallback; both use <target>/bin/codex. Unknown JS is never executed.
const NPM_LAUNCHER_SHA256 =
	"61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70";
const targets: Record<string, string> = {
	"darwin-arm64": "aarch64-apple-darwin",
	"darwin-x64": "x86_64-apple-darwin",
	"linux-arm64": "aarch64-unknown-linux-musl",
	"linux-x64": "x86_64-unknown-linux-musl",
};

export interface CodexNativeLaunchSnapshot {
	/** Exact configured executable, not a shell command or process-table match. */
	command: string;
	/** PATH and cwd from this launch; never substitute the current Host's PATH. */
	path: string;
	cwd: string;
	/** Wrapper directories belonging to this launch's Jedv profile. */
	managedBinDirs: readonly string[];
}
export type CodexNativeExecutableResult =
	| {
			supported: true;
			executable: string;
			version: string;
			source: "direct" | "npm";
	  }
	| {
			supported: false;
			reason:
				| "unsupported-platform"
				| "invalid-launch"
				| "not-found"
				| "unsupported-wrapper"
				| "unsupported-npm"
				| "invalid-native"
				| "unverified-version"
				| "unreadable";
	  };
export interface CodexNativeExecutableDependencies {
	platform?: NodeJS.Platform;
	arch?: string;
	readVersion?: (
		executable: string,
		snapshot: CodexNativeLaunchSnapshot,
	) => Promise<string | null>;
}

async function readBounded(file: string, limit: number): Promise<Buffer> {
	const handle = await open(
		file,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size > limit)
			throw new Error("Unsupported file");
		return await handle.readFile();
	} finally {
		await handle.close();
	}
}

async function nativeIdentity(file: string, platform: string) {
	const handle = await open(
		file,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size < 32) return null;
		const bytes = Buffer.alloc(4);
		if ((await handle.read(bytes, 0, 4, 0)).bytesRead !== 4) return null;
		const magic = bytes.toString("hex");
		const valid =
			platform === "darwin"
				? [
						"cffaedfe",
						"cefaedfe",
						"feedfacf",
						"feedface",
						"cafebabe",
						"bebafeca",
						"cafebabf",
						"bfbafeca",
					].includes(magic)
				: magic === "7f454c46";
		return valid
			? `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`
			: null;
	} finally {
		await handle.close();
	}
}

async function readVersion(
	executable: string,
	snapshot: CodexNativeLaunchSnapshot,
): Promise<string | null> {
	// Codex --version still creates arg0/apply_patch helpers. Never give this
	// probe a user's real CODEX_HOME or credentials from the launch snapshot.
	const root = await mkdtemp(join(tmpdir(), "jedv-codex-version-"));
	try {
		const appHome = join(root, "app");
		const userHome = join(root, "user");
		const codexHome = join(userHome, ".codex");
		await mkdir(appHome, { recursive: true });
		await mkdir(codexHome, { recursive: true });
		return (
			await execute(executable, ["--version"], {
				cwd: root,
				env: {
					PATH: snapshot.path,
					JEDV_HOME_DIR: appHome,
					JEDV_USER_HOME_DIR: userHome,
					CODEX_HOME: codexHome,
					TMPDIR: root,
				},
				timeout: 2_000,
				maxBuffer: 4096,
				encoding: "utf8",
			})
		).stdout.trim();
	} catch {
		return null;
	} finally {
		await rm(root, { recursive: true, force: true }).catch(() => {});
	}
}

function expectedManagedWrapper(binDir: string): string {
	const generatedBinDir = getBinDir();
	return buildWrapperScript(
		"codex",
		buildCodexWrapperExecLine(join(dirname(binDir), "hooks/notify.sh")),
		{
			agentId: "codex",
			beforeLaunch: buildDefaultAccountResolver(
				"CODEX_HOME",
				"default-codex-home",
				"JEDV_AMBIENT_CODEX_HOME",
			),
		},
	).replace(`      "${generatedBinDir}"|`, `      "${binDir}"|`);
}

function inside(root: string, candidate: string): boolean {
	const part = relative(root, candidate);
	return (
		part !== "" && part !== ".." && !part.startsWith("../") && !isAbsolute(part)
	);
}

/**
 * Resolve expected identity independently of the process being interrupted.
 * A missing/changed launch snapshot or an unsupported wrapper must stay
 * unsupported; callers must not fill the gap by selecting a PID named codex.
 * Version probes use disposable app/user/Codex homes. No user-config writes,
 * shell evaluation, model launch, or signals to existing processes.
 */
export async function resolveCodexNativeExecutable(
	snapshot: CodexNativeLaunchSnapshot,
	deps: CodexNativeExecutableDependencies = {},
): Promise<CodexNativeExecutableResult> {
	const platform = deps.platform ?? process.platform;
	const arch = deps.arch ?? process.arch;
	const platformKey = `${platform}-${arch}`;
	const target = targets[platformKey];
	if (!target) return { supported: false, reason: "unsupported-platform" };
	if (
		!isAbsolute(snapshot.cwd) ||
		!snapshot.command ||
		snapshot.command.includes("\0") ||
		(!snapshot.command.includes("/") && snapshot.command !== "codex")
	) {
		return { supported: false, reason: "invalid-launch" };
	}
	try {
		const paths = snapshot.path.split(delimiter);
		if (paths.length > 512)
			return { supported: false, reason: "invalid-launch" };
		const pathCandidates = paths.map((dir) =>
			resolve(snapshot.cwd, dir || ".", "codex"),
		);
		const candidates = snapshot.command.includes("/")
			? [resolve(snapshot.cwd, snapshot.command)]
			: [...pathCandidates];
		const managed = await Promise.all(
			snapshot.managedBinDirs.map(async (dir) => ({
				lexical: resolve(snapshot.cwd, dir),
				canonical: await realpath(resolve(snapshot.cwd, dir)).catch(() => ""),
			})),
		);
		const seen = new Set<string>();
		const finish = async (
			candidate: string,
			source: "direct" | "npm",
			expectedVersion?: string,
		): Promise<CodexNativeExecutableResult> => {
			const executable = await realpath(candidate);
			await access(executable, constants.X_OK);
			const before = await nativeIdentity(executable, platform);
			if (!before) return { supported: false, reason: "invalid-native" };
			const output = await (deps.readVersion ?? readVersion)(
				executable,
				snapshot,
			);
			const version = output
				?.trim()
				.match(/^codex-cli (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/)?.[1];
			if (
				!version ||
				(expectedVersion && version !== expectedVersion) ||
				(await realpath(candidate)) !== executable ||
				(await nativeIdentity(executable, platform)) !== before
			) {
				return { supported: false, reason: "unverified-version" };
			}
			return { supported: true, executable, version, source };
		};
		for (const candidate of candidates) {
			try {
				await access(candidate, constants.X_OK);
			} catch {
				continue;
			}
			if (!(await stat(candidate)).isFile()) continue;
			const canonical = await realpath(candidate);
			if (seen.has(canonical)) continue;
			seen.add(canonical);
			if (await nativeIdentity(canonical, platform)) {
				if (!["codex", `codex-${target}`].includes(basename(canonical)))
					return { supported: false, reason: "unsupported-wrapper" };
				return await finish(candidate, "direct");
			}
			const script = await readBounded(canonical, 128 * 1024);
			const source = script.toString("utf8");
			if (
				basename(canonical) === "codex" &&
				managed.some(
					(dir) =>
						dir.canonical === dirname(canonical) &&
						source === expectedManagedWrapper(dir.lexical),
				)
			) {
				// An explicitly configured managed wrapper searches the same launch
				// PATH; an arbitrary custom wrapper must never get this fallback.
				if (snapshot.command.includes("/") && candidates.length === 1)
					candidates.push(...pathCandidates);
				continue;
			}
			if (
				basename(canonical) !== "codex.js" ||
				basename(dirname(canonical)) !== "bin"
			)
				return { supported: false, reason: "unsupported-wrapper" };
			if (
				createHash("sha256").update(script).digest("hex") !==
				NPM_LAUNCHER_SHA256
			)
				return { supported: false, reason: "unsupported-npm" };
			const packageRoot = dirname(dirname(canonical));
			const manifest = JSON.parse(
				(
					await readBounded(join(packageRoot, "package.json"), 64 * 1024)
				).toString("utf8"),
			);
			const alias = `@openai/codex-${platformKey}`;
			if (
				manifest?.name !== "@openai/codex" ||
				manifest.bin?.codex !== "bin/codex.js" ||
				typeof manifest.version !== "string" ||
				manifest.optionalDependencies?.[alias] !==
					`npm:@openai/codex@${manifest.version}-${platformKey}`
			)
				return { supported: false, reason: "unsupported-npm" };
			let vendorPackageRoot = packageRoot;
			let platformManifestPath: string | undefined;
			try {
				platformManifestPath = createRequire(canonical).resolve(
					`${alias}/package.json`,
				);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND")
					return { supported: false, reason: "unsupported-npm" };
			}
			if (platformManifestPath) {
				const platformManifest = JSON.parse(
					(await readBounded(platformManifestPath, 64 * 1024)).toString("utf8"),
				);
				if (
					platformManifest?.name !== "@openai/codex" ||
					platformManifest.version !== `${manifest.version}-${platformKey}` ||
					!platformManifest.os?.includes(platform) ||
					!platformManifest.cpu?.includes(arch)
				)
					return { supported: false, reason: "unsupported-npm" };
				vendorPackageRoot = await realpath(dirname(platformManifestPath));
			}
			const binary = join(vendorPackageRoot, "vendor", target, "bin", "codex");
			if (!inside(vendorPackageRoot, await realpath(binary)))
				return { supported: false, reason: "invalid-native" };
			return await finish(binary, "npm", manifest.version);
		}
		return { supported: false, reason: "not-found" };
	} catch {
		// File errors may include launch environment or paths; expose only a code.
		return { supported: false, reason: "unreadable" };
	}
}
