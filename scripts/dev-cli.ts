#!/usr/bin/env bun
import { resolve } from "node:path";

const child = Bun.spawn(
	[
		process.execPath,
		"run",
		"--cwd",
		resolve(import.meta.dir, "../packages/cli"),
		"dev",
		...process.argv.slice(2),
	],
	{ stdio: ["inherit", "inherit", "inherit"], env: process.env },
);
process.exit(await child.exited);
