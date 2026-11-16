import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createCodexWrapper } from "./agent-wrappers-claude-codex-opencode";
import {
	type CodexNativeLaunchSnapshot,
	resolveCodexNativeExecutable,
} from "./codex-native-executable";

let root: string;
let savedApp: string | undefined;
let savedUser: string | undefined;
let probes: string[];
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "jedv-codex-native-"));
	savedApp = process.env.JEDV_HOME_DIR;
	savedUser = process.env.JEDV_USER_HOME_DIR;
	process.env.JEDV_HOME_DIR = join(root, "app");
	process.env.JEDV_USER_HOME_DIR = join(root, "user");
	mkdirSync(join(root, "app/bin"), { recursive: true });
	probes = [];
});
afterEach(() => {
	if (savedApp === undefined) delete process.env.JEDV_HOME_DIR;
	else process.env.JEDV_HOME_DIR = savedApp;
	if (savedUser === undefined) delete process.env.JEDV_USER_HOME_DIR;
	else process.env.JEDV_USER_HOME_DIR = savedUser;
	rmSync(root, { recursive: true, force: true });
});
function write(file: string, content: string | Buffer, mode = 0o755) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content, { mode });
	return file;
}
function native(file = join(root, "real bin/codex"), platform = "darwin") {
	return write(
		file,
		Buffer.concat([
			Buffer.from(platform === "darwin" ? "cffaedfe" : "7f454c46", "hex"),
			Buffer.alloc(60),
		]),
	);
}
function snapshot(
	overrides: Partial<CodexNativeLaunchSnapshot> = {},
): CodexNativeLaunchSnapshot {
	return {
		command: "codex",
		path: join(root, "real bin"),
		cwd: root,
		managedBinDirs: [join(root, "app/bin")],

		...overrides,
	};
}
function resolveSnapshot(input = snapshot(), version = "codex-cli 0.159.3") {
	return resolveCodexNativeExecutable(input, {
		platform: "darwin",
		arch: "arm64",
		readVersion: async (file) => {
			probes.push(file);
			return version;
		},
	});
}
const entry = readFileSync(
	join(
		import.meta.dir,
		"codex-native-executable.fixtures/npm-entry-0.159.3.txt",
	),
);
function npmFixture(aliasPackage = true) {
	const packageRoot = join(root, "node_modules/@openai/codex");
	const entrypoint = write(join(packageRoot, "bin/codex.js"), entry);
	write(
		join(packageRoot, "package.json"),
		JSON.stringify({
			name: "@openai/codex",
			version: "0.159.3",
			bin: { codex: "bin/codex.js" },
			optionalDependencies: {
				"@openai/codex-darwin-arm64": "npm:@openai/codex@0.159.3-darwin-arm64",
			},
		}),
	);
	const platformRoot = aliasPackage
		? join(root, "store/platform")
		: packageRoot;
	if (aliasPackage) {
		write(
			join(platformRoot, "package.json"),
			JSON.stringify({
				name: "@openai/codex",
				version: "0.159.3-darwin-arm64",
				os: ["darwin"],
				cpu: ["arm64"],
			}),
		);
		symlinkSync(
			platformRoot,
			join(root, "node_modules/@openai/codex-darwin-arm64"),
			"dir",
		);
	}
	const binary = native(
		join(platformRoot, "vendor/aarch64-apple-darwin/bin/codex"),
	);
	mkdirSync(join(root, "bin"));
	symlinkSync(entrypoint, join(root, "bin/codex"));
	return {
		entrypoint,
		platformRoot,
		packageRoot,
		binary,
		input: snapshot({ path: join(root, "bin") }),
	};
}

test("resolves the saved PATH's native binary through a symlink, never Host PATH", async () => {
	const binary = native();
	mkdirSync(join(root, "links"));
	symlinkSync(binary, join(root, "links/codex"));
	expect(
		await resolveSnapshot(snapshot({ path: join(root, "links") })),
	).toEqual({
		supported: true,
		executable: realpathSync(binary),
		version: "0.159.3",
		source: "direct",
	});
	expect(probes).toEqual([realpathSync(binary)]);
});
test("absolute and cwd-relative native paths do not require PATH lookup", async () => {
	const binary = native();
	for (const command of [binary, "./real bin/codex"])
		expect(
			await resolveSnapshot(snapshot({ command, path: "" })),
		).toMatchObject({ supported: true, executable: realpathSync(binary) });
});
test("skips only the launch profile's actual generated Jedv wrapper", async () => {
	const binary = native();
	createCodexWrapper();
	const input = snapshot({ path: `${root}/app/bin:${root}/real bin` });
	expect(await resolveSnapshot(input)).toMatchObject({
		supported: true,
		executable: realpathSync(binary),
	});
	expect(
		await resolveSnapshot({ ...input, command: join(root, "app/bin/codex") }),
	).toMatchObject({ supported: true, executable: realpathSync(binary) });
	expect(probes).toEqual([realpathSync(binary), realpathSync(binary)]);
});
test("an unknown executable wrapper shadows later valid Codex and is never executed", async () => {
	native();
	write(join(root, "custom/codex"), "#!/bin/bash\necho codex-cli 0.159.3\n");
	expect(
		await resolveSnapshot(
			snapshot({ path: `${root}/custom:${root}/real bin` }),
		),
	).toEqual({ supported: false, reason: "unsupported-wrapper" });
	expect(probes).toEqual([]);
});
test("a marker-only impostor and a managed-looking script outside managed dirs are unsupported", async () => {
	native();
	write(
		join(root, "app/bin/codex"),
		"#!/bin/bash\n# Jedv agent-wrapper v5\nexit 0\n",
	);
	expect(
		(
			await resolveSnapshot(
				snapshot({ path: `${root}/app/bin:${root}/real bin` }),
			)
		).supported,
	).toBe(false);
	createCodexWrapper();
	expect(
		(
			await resolveSnapshot(
				snapshot({
					path: `${root}/app/bin:${root}/real bin`,
					managedBinDirs: [],
				}),
			)
		).supported,
	).toBe(false);
	expect(probes).toEqual([]);
});
test.each([
	true,
	false,
])("resolves audited npm JS to the %s platform vendor layout without executing JS", async (aliasPackage) => {
	const fixture = npmFixture(aliasPackage);
	expect(await resolveSnapshot(fixture.input)).toEqual({
		supported: true,
		executable: realpathSync(fixture.binary),
		version: "0.159.3",
		source: "npm",
	});
	expect(probes).toEqual([realpathSync(fixture.binary)]);
});
test("changed npm launcher is unsupported even with official package metadata", async () => {
	const fixture = npmFixture();
	writeFileSync(
		fixture.entrypoint,
		Buffer.concat([entry, Buffer.from('\nconsole.log("custom wrapper");\n')]),
	);
	expect(await resolveSnapshot(fixture.input)).toEqual({
		supported: false,
		reason: "unsupported-npm",
	});
	expect(probes).toEqual([]);
});
test("npm alias version mismatch does not fall back to another package or PATH binary", async () => {
	const fixture = npmFixture();
	writeFileSync(
		join(fixture.platformRoot, "package.json"),
		JSON.stringify({
			name: "@openai/codex",
			version: "other",
			os: ["darwin"],
			cpu: ["arm64"],
		}),
	);
	expect(await resolveSnapshot(fixture.input)).toEqual({
		supported: false,
		reason: "unsupported-npm",
	});
	expect(probes).toEqual([]);
});
test("npm vendor symlink outside its package is unsupported", async () => {
	const fixture = npmFixture();
	rmSync(fixture.binary);
	symlinkSync(native(), fixture.binary);
	expect(await resolveSnapshot(fixture.input)).toEqual({
		supported: false,
		reason: "invalid-native",
	});
	expect(probes).toEqual([]);
});
test("npm vendor script is never executed, even when named codex", async () => {
	const fixture = npmFixture();
	writeFileSync(fixture.binary, "#!/bin/bash\necho codex-cli 0.159.3\n");
	expect(await resolveSnapshot(fixture.input)).toEqual({
		supported: false,
		reason: "invalid-native",
	});
	expect(probes).toEqual([]);
});
test("missing and nonexecutable candidates fail closed", async () => {
	expect(await resolveSnapshot()).toEqual({
		supported: false,
		reason: "not-found",
	});
	chmodSync(native(), 0o644);
	expect(await resolveSnapshot()).toEqual({
		supported: false,
		reason: "not-found",
	});
	expect(probes).toEqual([]);
});
test("native format alone cannot replace Codex version evidence", async () => {
	native();
	expect(await resolveSnapshot(snapshot(), "some other tool 0.159.3")).toEqual({
		supported: false,
		reason: "unverified-version",
	});
	const fixture = npmFixture();
	expect(await resolveSnapshot(fixture.input, "codex-cli 0.160.0")).toEqual({
		supported: false,
		reason: "unverified-version",
	});
});
test("a binary replaced during the version probe loses its identity", async () => {
	const binary = native();
	const result = await resolveCodexNativeExecutable(snapshot(), {
		platform: "darwin",
		arch: "arm64",
		readVersion: async () => {
			rmSync(binary);
			write(binary, Buffer.alloc(64));
			return "codex-cli 0.159.3";
		},
	});
	expect(result).toEqual({ supported: false, reason: "unverified-version" });
});
test("Linux ELF is supported independently of macOS and invalid launch forms never probe", async () => {
	const binary = native(join(root, "real bin/codex"), "linux");
	expect(
		await resolveCodexNativeExecutable(snapshot(), {
			platform: "linux",
			arch: "x64",
			readVersion: async () => "codex-cli 0.159.3",
		}),
	).toMatchObject({ supported: true, executable: realpathSync(binary) });
	for (const input of [
		snapshot({ command: "npx" }),
		snapshot({ command: "codex --eval" }),
		snapshot({ cwd: "." }),
	])
		expect((await resolveSnapshot(input)).supported).toBe(false);
	expect(
		await resolveCodexNativeExecutable(snapshot(), {
			platform: "win32",
			arch: "x64",
		}),
	).toEqual({ supported: false, reason: "unsupported-platform" });
	expect(probes).toEqual([]);
});

test("a modified managed wrapper with intact markers cannot be skipped", async () => {
	native();
	createCodexWrapper();
	const wrapper = join(root, "app/bin/codex");
	writeFileSync(
		wrapper,
		`${readFileSync(wrapper, "utf8")}\n# user customization\necho changed\n`,
	);
	expect(
		await resolveSnapshot(
			snapshot({ path: `${root}/app/bin:${root}/real bin` }),
		),
	).toEqual({ supported: false, reason: "unsupported-wrapper" });
	expect(probes).toEqual([]);
});

test("an arbitrary native executable or its codex symlink is never version-probed", async () => {
	const executable = native(join(root, "custom-runner"));
	mkdirSync(join(root, "aliases"));
	symlinkSync(executable, join(root, "aliases/codex"));
	for (const input of [
		snapshot({ command: executable }),
		snapshot({ path: join(root, "aliases") }),
	])
		expect(await resolveSnapshot(input)).toEqual({
			supported: false,
			reason: "unsupported-wrapper",
		});
	expect(probes).toEqual([]);
});
