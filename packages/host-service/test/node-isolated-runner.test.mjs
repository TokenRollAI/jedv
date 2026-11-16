import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativePreloadSource } from "../../../scripts/test-node-isolated.mjs";

const hostRequire = createRequire(import.meta.url);

for (const withTsx of [false, true]) {
	test(`isolated native redirects preserve both module systems${withTsx ? " with tsx" : ""} and reach child processes`, () => {
		const root = mkdtempSync(join(tmpdir(), "jedv-native-resolver-test-"));
		try {
			const redirects = {};
			for (const name of ["better-sqlite3", "node-pty"]) {
				const destination = join(root, "isolated", name);
				mkdirSync(join(destination, "lib"), { recursive: true });
				writeFileSync(
					join(destination, "package.json"),
					JSON.stringify({ name, main: "lib/index.js" }),
				);
				writeFileSync(
					join(destination, "lib/index.js"),
					`module.exports = ${JSON.stringify(`isolated:${name}`)};`,
				);
				writeFileSync(
					join(destination, "subpath.js"),
					'module.exports = "isolated:subpath";',
				);
				redirects[name] = destination;
			}
			const preload = join(root, "native.cjs");
			writeFileSync(preload, nativePreloadSource(redirects));
			const assertions = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import sqlite from 'better-sqlite3';
import pty from 'node-pty';
import subpath from 'node-pty/subpath.js';
const require = createRequire(import.meta.url);
assert.equal(sqlite, 'isolated:better-sqlite3');
assert.equal(pty, 'isolated:node-pty');
assert.equal(subpath, 'isolated:subpath');
assert.equal(require('better-sqlite3'), sqlite);
assert.equal(require('node-pty/subpath.js'), subpath);
assert.equal(require('node:assert/strict'), assert);
`;
			const child = join(root, "child.mjs");
			writeFileSync(child, assertions);
			const entry = join(root, withTsx ? "entry.mts" : "entry.mjs");
			writeFileSync(
				entry,
				`${assertions}
import { spawnSync } from 'node:child_process';
${withTsx ? 'const value: string = "transformed by tsx"; assert.equal(value, "transformed by tsx");' : ""}
const child = spawnSync(process.execPath, [${JSON.stringify(child)}], { encoding: 'utf8' });
assert.equal(child.status, 0, child.stderr);
const cjs = spawnSync(process.execPath, ['--eval', "require('node:assert/strict').equal(require('node-pty'), 'isolated:node-pty')"], { encoding: 'utf8' });
assert.equal(cjs.status, 0, cjs.stderr);
`,
			);
			const result = spawnSync(
				"node",
				[
					...(withTsx ? ["--import", hostRequire.resolve("tsx")] : []),
					"--test",
					entry,
				],
				{
					encoding: "utf8",
					timeout: 10_000,
					env: {
						...process.env,
						NODE_OPTIONS:
							`${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(preload)}`.trim(),
					},
				},
			);
			expect({
				status: result.status,
				output: result.status === 0 ? "" : result.stdout + result.stderr,
			}).toEqual({ status: 0, output: "" });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}
