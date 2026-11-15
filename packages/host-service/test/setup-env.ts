// Isolates JEDV_HOME_DIR. `bun test` run inside this package reads this
// bunfig, not the root one, so the guard has to be re-entered here — and this
// package is where the pointer writers live.
import "../../../scripts/test-preload.ts";
import { linguiMacroPlugin } from "@jedv/i18n/bun-plugin";

// Match the host bundle compiler for source tests that import mobile assets.
await Bun.plugin(linguiMacroPlugin);

// Populate the env vars `src/env.ts` validates at module load so test runtimes
// that boot host-service via `createApp` (instead of `serve.ts`) can import
// modules that transitively load the validated env. Real values come from
// each test's `createTestHost` config; these defaults exist purely to satisfy
// schema validation at import time.

process.env.ORGANIZATION_ID ??= "00000000-0000-4000-8000-000000000000";
process.env.HOST_DB_PATH ??= "/tmp/host-service-test.db";
process.env.HOST_MIGRATIONS_FOLDER ??= "/tmp/host-service-test-migrations";
