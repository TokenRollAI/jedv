import type { SlashCommand as SharedSlashCommand } from "@jedv/shared/slash-commands";

export type {
	SlashCommandEntryKind,
	SlashCommandIdentity,
	SlashCommandKind,
	SlashCommandSource,
	SlashCommandTrigger,
} from "@jedv/shared/slash-commands";
export {
	findSlashCommandByNameOrAlias,
	getCommandMatchRank,
	shouldSuppressSlashMenuForCommittedCommand,
	sortSlashCommandMatches,
} from "@jedv/shared/slash-commands";

export interface ModelOption {
	id: string;
	name: string;
	provider: string;
}

export type SlashCommandActionType =
	| "new_session"
	| "set_model"
	| "stop_stream"
	| "show_mcp_overview";

export interface SlashCommandActionDefinition {
	type: SlashCommandActionType;
	passArguments?: boolean;
}

export interface SlashCommand extends SharedSlashCommand {
	action?: SlashCommandActionDefinition;
}
