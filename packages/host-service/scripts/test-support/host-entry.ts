// One module graph keeps the real host and PTY helpers on the same registries.
export { createApp } from "../../src/app";
export * as daemonClient from "../../src/terminal/daemon-client-singleton";
export { initTerminalBaseEnv } from "../../src/terminal/env";
export * as terminal from "../../src/terminal/terminal";
export { __setAccountShellForTesting } from "../../src/terminal/user-shell";
