import {
	closeSync,
	constants,
	fstatSync,
	openSync,
	readFileSync,
} from "node:fs";
import { CLIError, string } from "@jedv/cli-framework";
import { memoryTransferSchema } from "@jedv/shared/memory";
import { command } from "../../../lib/command";
import { memoryOptions, memoryScope, memoryTarget } from "../helpers";
export default command({
	description:
		"Import JSON with content deduplication (project paths are resolved on host)",
	options: {
		...memoryOptions(),
		file: string()
			.required()
			.desc("JSON file; project imports must stay inside project"),
	},
	run: async ({ ctx, options }) => {
		const target = await memoryTarget(ctx, options);
		const scope = await memoryScope(options, target);
		if (scope.scopeKind === "project")
			return {
				data: await target.client.memory.importProject.mutate({
					projectId: scope.scopeId,
					filePath: options.file,
				}),
			};
		const fd = openSync(
			options.file,
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			if (fstatSync(fd).size > 5000000)
				throw new CLIError("Memory import exceeds 5 MB");
			const data = memoryTransferSchema.parse(
				JSON.parse(readFileSync(fd, "utf8")),
			);
			return {
				data: await target.client.memory.importData.mutate({ scope, data }),
			};
		} finally {
			closeSync(fd);
		}
	},
});
