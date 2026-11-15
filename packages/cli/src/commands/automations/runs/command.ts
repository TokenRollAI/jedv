import { boolean, CLIError, positional } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { automationOptions, automationQuery } from "../helpers";
export default command({
	description: "Read persisted automation runs and execution errors",
	args: [positional("automationId").required().desc("Automation UUID")],
	options: {
		...automationOptions(),
		errors: boolean().desc(
			"Only runs with an error or failed/interrupted status",
		),
	},
	run: async ({ ctx, options, args }) => {
		const automationId = args.automationId;
		if (!automationId) throw new CLIError("Missing automation ID");
		const runs = await automationQuery(ctx, options, (client) =>
			client.automations.listRuns.query({ automationId }),
		);
		return {
			data: options.errors
				? runs.filter(
						(run) =>
							run.error ||
							run.status === "failed" ||
							run.status === "interrupted",
					)
				: runs,
		};
	},
});
