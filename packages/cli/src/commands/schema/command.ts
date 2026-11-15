import { generateSchema, introspectCli } from "@jedv/cli-framework";
import { command } from "../../lib/command";

export default command({
	description:
		"Print every command, option and argument as JSON, for tooling that must not parse --help",
	skipMiddleware: true,
	run: async () => ({ data: generateSchema(introspectCli()) }),
});
