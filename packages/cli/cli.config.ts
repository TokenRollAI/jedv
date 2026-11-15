import { boolean, defineConfig } from "@jedv/cli-framework";
import { linguiMacroPlugin } from "@jedv/i18n/bun-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
	name: "jedv",
	version: pkg.version,
	commandsDir: "./src/commands",
	outfile: "./dist/jedv",
	plugins: [linguiMacroPlugin],
	define: {
		"process.env.JEDV_VERSION": JSON.stringify(pkg.version),
		"process.env.JEDV_CLI_CHANNEL": JSON.stringify(
			process.env.JEDV_CLI_CHANNEL ?? "standalone",
		),
	},
	globals: {
		json: boolean().desc("Output as JSON (auto-on under CI/agent envs)"),
		quiet: boolean().desc("Output IDs only"),
	},
	audiences: () => ["public"],
	help: {
		tagline: "Manage local Jedv workspaces and native coding agents.",
		tip: "Run `jedv start --daemon` to start the local host.",
		sections: [
			{
				title: "Workspaces & agents",
				commands: [
					"workspaces",
					"worktrees",
					"sessions",
					"agents",
					"terminals",
					"team",
					"mail",
					"memory",
					"butler",
					"automations",
					"peers",
					"mobile",
					"slots",
					"panes",
					"snapshot",
					"scripts",
				],
			},

			{
				title: "Hosts & projects",
				commands: ["hosts", "projects", "start", "status", "stop"],
			},
			{ title: "Desktop", commands: ["settings", "notifications"] },
			{ title: "Shell & tooling", commands: ["completion", "schema"] },
		],
		examples: [
			{
				cmd: "jedv ws create --local --project <id> --name fix-tests --branch fix-tests",
				desc: "Create an independent Git worktree",
			},
			{
				cmd: "jedv terminals read --local --workspace <id> --terminal <id>",
				desc: "Read a running terminal",
			},
		],
	},
});
