import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.length === 0) {
	throw new Error(
		"Pass Node test arguments, for example --import tsx --test src/terminal/terminal.send-snapshot.node-test.ts",
	);
}

// Copy the installed, patched sources before building. Never rebuild the
// workspace's addons: Electron and system Node use different ABIs.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostRequire = createRequire(
	join(repo, "packages/host-service/package.json"),
);
const desktopRequire = createRequire(join(repo, "apps/desktop/package.json"));
const builderRequire = createRequire(
	desktopRequire.resolve("electron-builder"),
);
const nodeGyp = builderRequire.resolve("node-gyp/bin/node-gyp.js");
const root = mkdtempSync(join(tmpdir(), "jedv-node-tests-"));
const env = { ...process.env };
for (const key of Object.keys(env)) {
	if (/^npm_config_(target|runtime|disturl|dist_url|nodedir|arch)$/i.test(key))
		delete env[key];
}
delete env.ELECTRON_RUN_AS_NODE;
env.JEDV_HOME_DIR = join(root, "app-home");
env.JEDV_USER_HOME_DIR = join(root, "user-home");
mkdirSync(env.JEDV_HOME_DIR, { recursive: true });
mkdirSync(env.JEDV_USER_HOME_DIR, { recursive: true });

function run(args, options = {}) {
	const result = spawnSync(process.execPath, args, {
		env,
		stdio: "inherit",
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`Node command failed (${result.status ?? result.signal}): ${args.join(" ")}`,
		);
}

try {
	const redirects = {};
	for (const name of ["better-sqlite3", "node-pty"]) {
		const sourceManifest = hostRequire.resolve(`${name}/package.json`);
		const source = dirname(sourceManifest);
		const destination = join(root, "node_modules", name);
		cpSync(source, destination, {
			recursive: true,
			filter: (path) =>
				path !== join(source, "node_modules") && path !== join(source, "build"),
		});
		const packageRequire = createRequire(sourceManifest);
		const dependencies =
			JSON.parse(readFileSync(sourceManifest, "utf8")).dependencies ?? {};
		for (const dependency of Object.keys(dependencies)) {
			const link = join(destination, "node_modules", dependency);
			mkdirSync(dirname(link), { recursive: true });
			const dependencyRoot = dirname(
				packageRequire.resolve(`${dependency}/package.json`),
			);
			// gyp emits target files beside node-addon-api's gyp include; that
			// dependency must also be a copy, not a link back to shared sources.
			if (dependency === "node-addon-api")
				cpSync(dependencyRoot, link, { recursive: true });
			else symlinkSync(dependencyRoot, link, "junction");
		}
		run([nodeGyp, "rebuild", "--release"], { cwd: destination });
		redirects[name] = destination;
	}
	// NODE_OPTIONS reaches test-runner children and daemon subprocesses, whereas
	// a loader on just the parent would leave those loading the shared addons.
	const preload = join(root, "native.cjs");
	writeFileSync(
		preload,
		`
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const roots = ${JSON.stringify(redirects)};
registerHooks({ resolve(specifier, context, nextResolve) {
  for (const [name, root] of Object.entries(roots)) {
    if (specifier === name || specifier.startsWith(name + '/')) {
      return nextResolve(pathToFileURL(root + '/' + (specifier === name ? 'lib/index.js' : specifier.slice(name.length + 1))).href, context);
    }
  }
  return nextResolve(specifier, context);
} });
`,
	);
	env.NODE_OPTIONS =
		`${env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(preload)}`.trim();
	run(args);
} finally {
	rmSync(root, { recursive: true, force: true });
}
