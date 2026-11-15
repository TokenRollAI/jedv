import { boolean, CLIError, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import { memoryOptions, memoryScope, memoryTarget } from "../helpers";
export default command({
	description: "Export JSON; project default is .jedv/memory.json on the host",
	options: {
		...memoryOptions(),
		out: string().desc("JSON path inside project"),
		stdout: boolean().desc("Return JSON without writing a file"),
	},
	run: async ({ ctx, options }) => {
		const target = await memoryTarget(ctx, options);
		const scope = await memoryScope(options, target);
		if (scope.scopeKind === "project" && !options.stdout)
			return {
				data: await target.client.memory.exportProject.mutate({
					projectId: scope.scopeId,
					filePath: options.out,
				}),
			};
		if (options.out) throw new CLIError("--out requires project scope");
		return { data: await target.client.memory.exportData.query(scope) };
	},
});
