import { resolve } from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import reactPlugin, { reactCompilerPreset } from "@vitejs/plugin-react";
import { config } from "dotenv";
import { defineConfig } from "electron-vite";
import injectProcessEnvPlugin from "rollup-plugin-inject-process-env";
import { resources, version } from "./package.json";
import { mainExternalizedDependencies } from "./runtime-dependencies";
import {
	copyResourcesPlugin,
	defineEnv,
	devPath,
	linguiMacroPlugin,
} from "./vite/helpers";

// override: true ensures .env values take precedence over inherited env vars
config({ path: resolve(__dirname, "../../.env"), override: true, quiet: true });

const DEV_SERVER_PORT = Number(process.env.DESKTOP_VITE_PORT || 5173);

// Validate required env vars at build time using the Zod schema (single source of truth)
await import("./src/main/env.main");

export default defineConfig({
	main: {
		plugins: [linguiMacroPlugin(), copyResourcesPlugin()],

		define: {
			"process.env.NODE_ENV": defineEnv(process.env.NODE_ENV, "production"),
			"process.env.SKIP_ENV_VALIDATION": defineEnv(
				process.env.SKIP_ENV_VALIDATION,
				"",
			),

			"process.env.DESKTOP_VITE_PORT": defineEnv(process.env.DESKTOP_VITE_PORT),
			"process.env.JEDV_WORKSPACE_NAME": defineEnv(
				process.env.JEDV_WORKSPACE_NAME,
			),
			"process.env.DESKTOP_DISPLAY_NAME": defineEnv(
				process.env.DESKTOP_DISPLAY_NAME,
				"Jedv",
			),
		},

		build: {
			sourcemap: true,
			externalizeDeps: false,
			rollupOptions: {
				input: {
					index: resolve("src/main/index.ts"),
					// Worker-thread entrypoint for heavy git/status computations
					"git-task-worker": resolve("src/main/git-task-worker.ts"),
					// Workspace service - local HTTP/tRPC server per org
					"host-service": resolve("src/main/host-service/index.ts"),
					// pty-daemon - long-lived per-org Unix-socket server that owns PTYs.
					// Spawned by PtyDaemonCoordinator; survives host-service restarts.
					"pty-daemon": resolve("src/main/pty-daemon/index.ts"),
					// host-service worker thread — emitted side-by-side with
					// host-service.js so the pool's script resolution finds it.
					"host-worker": resolve("src/main/host-worker/index.ts"),
				},
				output: {
					dir: resolve(devPath, "main"),
				},
				external: ["electron", ...mainExternalizedDependencies],
			},
		},
		resolve: {
			tsconfigPaths: true,
			alias: {
				// @xterm/headless 6.0.0 has a packaging bug: `module` field points to
				// non-existent `lib/xterm.mjs`. Force Vite to use the CJS entry instead.
				"@xterm/headless": "@xterm/headless/lib-headless/xterm-headless.js",
			},
		},
	},

	preload: {
		resolve: { tsconfigPaths: true },

		define: {
			"process.env.NODE_ENV": defineEnv(process.env.NODE_ENV, "production"),
			"process.env.SKIP_ENV_VALIDATION": defineEnv(
				process.env.SKIP_ENV_VALIDATION,
				"",
			),
			__APP_VERSION__: defineEnv(version),
		},

		build: {
			outDir: resolve(devPath, "preload"),
			externalizeDeps: false,
			rollupOptions: {
				input: {
					index: resolve("src/preload/index.ts"),
				},
			},
		},
	},

	renderer: {
		define: {
			"process.env.NODE_ENV": defineEnv(process.env.NODE_ENV),
			"process.env.SKIP_ENV_VALIDATION": defineEnv(
				process.env.SKIP_ENV_VALIDATION,
				"",
			),
			"process.platform": defineEnv(process.platform),

			"import.meta.env.DEV_SERVER_PORT": defineEnv(String(DEV_SERVER_PORT)),

			"process.env.DESKTOP_VITE_PORT": defineEnv(process.env.DESKTOP_VITE_PORT),
			"process.env.DESKTOP_NOTIFICATIONS_PORT": defineEnv(
				process.env.DESKTOP_NOTIFICATIONS_PORT,
			),
			"process.env.JEDV_WORKSPACE_NAME": defineEnv(
				process.env.JEDV_WORKSPACE_NAME,
			),
			"process.env.DESKTOP_DISPLAY_NAME": defineEnv(
				process.env.DESKTOP_DISPLAY_NAME,
				"Jedv",
			),
		},

		server: {
			port: DEV_SERVER_PORT,
			strictPort: false,
		},

		plugins: [
			tanstackRouter({
				target: "react",
				routesDirectory: resolve("src/renderer/routes"),
				generatedRouteTree: resolve("src/renderer/routeTree.gen.ts"),
				indexToken: "page",
				routeToken: "layout",
				autoCodeSplitting: true,
				routeFileIgnorePattern:
					"^(?!(__root|page|layout)\\.tsx$).*\\.(tsx?|jsx?)$",
			}),
			tailwindcss(),
			reactPlugin(),
			// Babel runs plugins before presets, so the macro sees `t` calls before the compiler rewrites them.
			babel({
				plugins: ["@lingui/babel-plugin-lingui-macro"],
				presets: [reactCompilerPreset()],
			}),
		],

		resolve: { tsconfigPaths: true },

		worker: {
			format: "es",
		},

		publicDir: resolve(resources, "public"),

		build: {
			sourcemap: true,
			outDir: resolve(devPath, "renderer"),

			rollupOptions: {
				plugins: [
					injectProcessEnvPlugin({
						NODE_ENV: "production",
						platform: process.platform,
					}),
				].filter(Boolean),

				input: {
					index: resolve("src/renderer/index.html"),
				},
			},
		},
	},
});
