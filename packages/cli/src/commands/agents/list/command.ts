import { boolean, string, table } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { requireHostTarget, resolveHostTarget } from "../../../lib/host-target";

export default command({
	description: "List agents configured on a host",
	options: {
		host: string().desc("Target host machineId (required unless --local)"),
		local: boolean().desc("Target this machine (required unless --host)"),
	},
	display: (data) =>
		table(
			(data ?? []) as Record<string, unknown>[],
			["label", "presetId", "command", "id"],
			["LABEL", "PRESET", "COMMAND", "ID"],
		),
	run: async ({ ctx, options }) => {
		const organizationId = ctx.config.organizationId;

		const hostId = requireHostTarget({
			host: options.host ?? undefined,
			local: options.local ?? undefined,
		});

		const target = await resolveHostTarget({
			requestedHostId: hostId,
			organizationId,
		});

		return await target.client.settings.agentConfigs.list.query();
	},
});
