import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveAmbientCodexHome } from "./provider-profiles";

describe("resolveAmbientCodexHome", () => {
	const HOME = "/home/tester";
	let previousCodexHome: string | undefined;
	let previousInjected: string | undefined;
	let previousAmbient: string | undefined;

	beforeEach(() => {
		previousCodexHome = process.env.CODEX_HOME;
		previousInjected = process.env.JEDV_DEFAULT_CODEX_HOME;
		previousAmbient = process.env.JEDV_AMBIENT_CODEX_HOME;
	});

	afterEach(() => {
		for (const [key, value] of [
			["CODEX_HOME", previousCodexHome],
			["JEDV_DEFAULT_CODEX_HOME", previousInjected],
			["JEDV_AMBIENT_CODEX_HOME", previousAmbient],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("falls back to ~/.codex when nothing is set", () => {
		delete process.env.CODEX_HOME;
		delete process.env.JEDV_DEFAULT_CODEX_HOME;
		delete process.env.JEDV_AMBIENT_CODEX_HOME;
		expect(resolveAmbientCodexHome(HOME)).toBe(path.join(HOME, ".codex"));
	});

	it("honours a CODEX_HOME the user set themselves", () => {
		process.env.CODEX_HOME = "/home/tester/my-codex";
		delete process.env.JEDV_DEFAULT_CODEX_HOME;
		delete process.env.JEDV_AMBIENT_CODEX_HOME;
		expect(resolveAmbientCodexHome(HOME)).toBe("/home/tester/my-codex");
	});

	it("ignores Jedv's own injected value", () => {
		// Every Jedv terminal and agent launch exports the selected account
		// as CODEX_HOME. A host-service (or any tool) started from such a
		// terminal inherits it; trusting it would make the selected profile
		// masquerade as the system default and share config out of itself.
		process.env.CODEX_HOME = "/home/tester/.codex-work";
		process.env.JEDV_DEFAULT_CODEX_HOME = "/home/tester/.codex-work";
		delete process.env.JEDV_AMBIENT_CODEX_HOME;
		expect(resolveAmbientCodexHome(HOME)).toBe(path.join(HOME, ".codex"));
	});

	it("normalizes the injected value before comparing it", () => {
		process.env.CODEX_HOME = "/home/tester/.codex-work/../.codex-work";
		process.env.JEDV_DEFAULT_CODEX_HOME = "/home/tester/.codex-work";
		delete process.env.JEDV_AMBIENT_CODEX_HOME;
		expect(resolveAmbientCodexHome(HOME)).toBe(path.join(HOME, ".codex"));
	});

	it("recognizes a symlink spelling of the injected value", () => {
		const root = mkdtempSync(path.join(tmpdir(), "jedv-codex-ambient-"));
		try {
			const profile = path.join(root, "profile");
			const alias = path.join(root, "profile-alias");
			mkdirSync(profile);
			symlinkSync(profile, alias);
			process.env.CODEX_HOME = alias;
			process.env.JEDV_DEFAULT_CODEX_HOME = profile;
			delete process.env.JEDV_AMBIENT_CODEX_HOME;
			expect(resolveAmbientCodexHome(HOME)).toBe(path.join(HOME, ".codex"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("recovers a preserved custom default behind an injected profile", () => {
		process.env.CODEX_HOME = "/home/tester/.codex-work";
		process.env.JEDV_DEFAULT_CODEX_HOME =
			"/home/tester/.codex-work/../.codex-work";
		process.env.JEDV_AMBIENT_CODEX_HOME = "/home/tester/my-codex";
		expect(resolveAmbientCodexHome(HOME)).toBe("/home/tester/my-codex");
	});

	it("still honours a user override that differs from the injected value", () => {
		process.env.CODEX_HOME = "/home/tester/my-codex";
		process.env.JEDV_DEFAULT_CODEX_HOME = "/home/tester/.codex-work";
		process.env.JEDV_AMBIENT_CODEX_HOME = "/home/tester/original-codex";
		expect(resolveAmbientCodexHome(HOME)).toBe("/home/tester/my-codex");
	});
});
