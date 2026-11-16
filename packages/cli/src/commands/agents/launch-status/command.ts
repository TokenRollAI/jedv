import { boolean, string } from "@jedv/cli-framework";
import { i18n, initI18n } from "@jedv/i18n";
import { isMissingProcedureError } from "@jedv/shared/missing-procedure-error";
import { command } from "../../../lib/command";
import { resolveWorkspaceTarget } from "../../../lib/host-workspaces";

if (!i18n.locale) initI18n();

export default command({
	description: i18n._(
		"Inspect launch evidence; starting or unknown does not mean the agent is ready",
	),
	options: {
		workspace: string().required().desc(i18n._("Workspace ID")),
		host: string().desc(i18n._("Host on this machine (default: local)")),
		local: boolean().desc(i18n._("The workspace is on this machine")),
		terminal: string()
			.required()
			.desc(i18n._("Terminal sessionId returned by agents create")),
		run: string()
			.required()
			.desc(i18n._("Launch runId returned by agents create")),
	},
	run: async ({ ctx, options }) => {
		const { target } = await resolveWorkspaceTarget(
			{
				organizationId: ctx.config.organizationId,
				host: options.host,
				local: options.local,
			},
			options.workspace,
		);
		try {
			const data = await target.client.agents.launchStatus.query({
				workspaceId: options.workspace,
				sessionId: options.terminal,
				runId: options.run,
			});
			return { data };
		} catch (error) {
			if (!isMissingProcedureError(error)) throw error;
			return { data: { state: "unknown" as const, supported: false } };
		}
	},
});
