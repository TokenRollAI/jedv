/**
 * Test preload: give every test run its own Jedv home.
 *
 * Production code resolves `~/.jedv` from `JEDV_HOME_DIR` (see
 * agent-setup's resolveAppHomeDir and the mirror in the usage router's
 * default-account.ts). A test that calls such code with the variable unset
 * writes to the developer's REAL home. That is not hypothetical: the default
 * agent-account tests wrote `$TMPDIR` into the live
 * `~/.jedv/state/default-codex-home` pointer, which every Jedv
 * terminal and agent launch then injected as `CODEX_HOME`, so Codex ran
 * signed out with none of its session history and re-logins landed in a
 * directory macOS periodically purges.
 *
 * Setting it here — before any test module loads — makes that whole class of
 * accident impossible rather than something each test file has to remember.
 *
 * The override is unconditional, and that is the point. Every Jedv
 * terminal exports `JEDV_HOME_DIR=~/.jedv`, and that is where the
 * team runs `bun test`, so the variable is not merely unset-and-forgotten —
 * it arrives already aimed at the real home. A `??=` default would be a
 * no-op in exactly the environment that needs it. Tests wanting a specific
 * home still set one in their own `beforeEach`, which runs after this.
 *
 * Loaded from the root bunfig.toml and re-entered by each package preload
 * that has one; `test/jedv-home-isolation.test.ts` fails loudly if a run
 * ever loses it.
 */

import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testJedvHome = mkdtempSync(join(tmpdir(), "jedv-test-home-"));
process.env.JEDV_HOME_DIR = testJedvHome;
Reflect.set(globalThis, Symbol.for("jedv.test.jedvHome"), testJedvHome);

// Test processes are short-lived, but a full local run creates enough state
// here to make relying on the OS's eventual temp cleanup needlessly noisy.
// The exit hook is synchronous because Node/Bun cannot await async work once
// process shutdown has begun; best-effort cleanup must never mask test status.
function cleanupTestJedvHome(): void {
	try {
		rmSync(testJedvHome, { recursive: true, force: true });
	} catch {
		// The temp directory may already have been removed by a test.
	}
}

// Bun's test runner does not consistently emit Node's process exit event, so
// use its lifecycle hook as the primary cleanup and retain exit as a fallback
// for alternate runners that load the same preload.
afterAll(cleanupTestJedvHome);
process.once("exit", cleanupTestJedvHome);
