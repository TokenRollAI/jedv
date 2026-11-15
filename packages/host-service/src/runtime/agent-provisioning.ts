import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	getAgentSetupTemplatesDir,
	setAgentSetupTemplatesDir,
	setupAgentIntegrations,
} from "@jedv/agent-setup";

function resolveAgentTemplatesDir(): string | undefined {
	const fromEnv = process.env.JEDV_AGENT_TEMPLATES_DIR?.trim();
	if (fromEnv) return fromEnv;
	const sideBySide = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"agent-templates",
	);
	return existsSync(sideBySide) ? sideBySide : undefined;
}

export async function provisionAgentIntegrations(): Promise<void> {
	try {
		const templatesDir = resolveAgentTemplatesDir();
		if (templatesDir) setAgentSetupTemplatesDir(templatesDir);
		const effectiveDir = getAgentSetupTemplatesDir();
		if (!existsSync(path.join(effectiveDir, "notify-hook.template.sh"))) {
			console.error(
				`[jedv-host] Agent templates missing at ${effectiveDir}. Reinstall the CLI or set JEDV_AGENT_TEMPLATES_DIR.`,
			);
			return;
		}
		setupAgentIntegrations();
	} catch (error) {
		console.warn("[jedv-host] Agent integration provisioning failed:", error);
	}
}
