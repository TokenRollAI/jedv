import { describe, expect, it } from "bun:test";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function canonical(target: string): string {
	try {
		return realpathSync(target);
	} catch {
		return resolve(target);
	}
}

/**
 * Canary for scripts/test-preload.ts. This file deliberately sets nothing up:
 * if the preload is dropped from a bunfig, or a run loads this package's tests
 * without it, these fail instead of the suite quietly writing the developer's
 * real ~/.jedv — which is how the default agent-account pointers got
 * clobbered before (see scripts/test-preload.ts).
 */
describe("Jedv home isolation", () => {
	function requireIsolatedHome(): string {
		const isolated = process.env.JEDV_HOME_DIR;
		const preloadHome = Reflect.get(
			globalThis,
			Symbol.for("jedv.test.jedvHome"),
		);
		if (!isolated || typeof preloadHome !== "string") {
			throw new Error("JEDV_HOME_DIR is not isolated for tests");
		}
		const canonicalHome = canonical(isolated);
		if (
			canonicalHome !== canonical(preloadHome) ||
			[".jedv", ".paradev", ".superset"].some(
				(dir) => canonicalHome === canonical(join(homedir(), dir)),
			)
		) {
			throw new Error("JEDV_HOME_DIR is not isolated for tests");
		}
		return canonicalHome;
	}

	it("points JEDV_HOME_DIR somewhere other than the real home", () => {
		expect(requireIsolatedHome()).toBeTruthy();
	});

	it("resolves the account pointer dir inside the isolated home", async () => {
		// Validate before importing or calling the pointer writer. If the preload
		// disappears, this canary must fail without reproducing the real-home
		// clobber it exists to prevent.
		const isolated = requireIsolatedHome();
		const { syncDefaultAccountPointer } = await import(
			"../src/trpc/router/usage/default-account.ts"
		);
		syncDefaultAccountPointer("codex", null);
		const { existsSync } = await import("node:fs");
		expect(existsSync(join(isolated, "state", "default-codex-home"))).toBe(
			true,
		);
	});
});
