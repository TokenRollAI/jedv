import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createAutomationTestHost } from "../automations/test-host";
import { hostAgentConfigs } from "../db/schema";
import { resolveAcpLaunchSpec } from "./acpHarnesses";

test("selected ACP config supplies the real executable/env and never drops unforwardable service argv", async () => {
	const home = mkdtempSync(join(tmpdir(), "jedv-acp-config-"));
	const program = join(home, "configured provider");
	writeFileSync(
		program,
		`#!${process.execPath}\nif(process.argv.includes('--version')) console.log('configured-agent 3.0.0'); else process.exit(1);\n`,
		{ mode: 0o755 },
	);
	const host = createAutomationTestHost(home);
	try {
		const providers = [
			{
				provider: "claude",
				harness: "claude-acp",
				args: ["--dangerously-skip-permissions"],
				executableEnv: "CLAUDE_CODE_EXECUTABLE",
				mode: "bypassPermissions",
				nativeArgs: [],
			},
			{
				provider: "codex",
				harness: "codex-acp",
				args: [
					"--dangerously-bypass-approvals-and-sandbox",
					"--dangerously-bypass-hook-trust",
				],
				executableEnv: "CODEX_PATH",
				mode: "agent-full-access",
				nativeArgs: [],
			},
			{
				provider: "agy",
				harness: "agy-acp",
				args: ["--mode", "accept-edits"],
				executableEnv: null,
				mode: undefined,
				nativeArgs: ["--mode", "accept-edits", "acp", "--stdio"],
			},
			{
				provider: "kimi",
				harness: "kimi-acp",
				args: ["--yolo"],
				executableEnv: null,
				mode: undefined,
				nativeArgs: ["--yolo", "acp"],
			},
		];
		for (const entry of providers) {
			const id = randomUUID();
			host.db
				.insert(hostAgentConfigs)
				.values({
					id,
					presetId: entry.provider,
					label: `configured ${entry.provider}`,
					command: "env",
					argsJson: JSON.stringify([
						"TZ=Asia/Shanghai",
						"LANG=zh_CN.UTF-8",
						program,
						...entry.args,
					]),
					envJson: JSON.stringify({ PROFILE: "selected", TZ: "UTC" }),
					promptTransport: "argv",
					displayOrder: 0,
				})
				.run();
			const options = {
				sessionId: randomUUID(),
				scopeId: "workspace",
				cwd: home,
				harness: entry.harness,
				agentConfigId: id,
			};
			const launch = await resolveAcpLaunchSpec(
				entry.harness,
				host.db,
				options,
				entry.executableEnv ? "/fixture/translator.js" : undefined,
				async () => ({ PATH: process.env.PATH, AMBIENT: "preserved" }),
			);
			expect(launch.env).toMatchObject({
				TZ: "Asia/Shanghai",
				LANG: "zh_CN.UTF-8",
				PROFILE: "selected",
				AMBIENT: "preserved",
			});
			expect(launch.defaultModeId).toBe(entry.mode);
			if (entry.executableEnv) {
				expect(launch.command).toBe(process.execPath);
				expect(launch.args).toEqual(["/fixture/translator.js"]);
				expect(launch.env[entry.executableEnv]).toBe(program);
				host.db
					.update(hostAgentConfigs)
					.set({
						argsJson: JSON.stringify([
							program,
							...entry.args,
							"-c",
							"model=custom",
						]),
					})
					.where(eq(hostAgentConfigs.id, id))
					.run();
				await expect(
					resolveAcpLaunchSpec(
						entry.harness,
						host.db,
						options,
						"/fixture/translator.js",
						async () => ({ PATH: process.env.PATH }),
					),
				).rejects.toThrow("CLI-only");
				host.db
					.update(hostAgentConfigs)
					.set({ command: program, argsJson: "[]" })
					.where(eq(hostAgentConfigs.id, id))
					.run();
				expect(
					(
						await resolveAcpLaunchSpec(
							entry.harness,
							host.db,
							options,
							"/fixture/translator.js",
							async () => ({ PATH: process.env.PATH }),
						)
					).defaultModeId,
				).toBeUndefined();
			} else {
				expect(launch.command).toBe(program);
				expect(launch.args).toEqual(entry.nativeArgs);
			}
		}
	} finally {
		await host.dispose();
		rmSync(home, { recursive: true, force: true });
	}
});
