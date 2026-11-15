import { createCommand } from "@jedv/cli-framework";

export interface CliContext {
	config: { organizationId: string };
}

export const command = createCommand<CliContext>();
