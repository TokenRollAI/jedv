import { randomUUID } from "node:crypto";
import { CLIError, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";
export default command({
	description:
		"Send durable mail to a member, leader, or Team; reading never implies acknowledgement",
	options: {
		...teamworkOptions(),
		peer: string().desc("Remote peer ID; requires --remote-team"),
		remoteTeam: string().desc("Target Team ID on --peer"),
		to: string().required().desc("Member name/ID, leader, or team"),
		body: string()
			.required()
			.desc("Mail body (never injected directly into the recipient PTY)"),
		subject: string().desc("Subject"),
		type: string().default("agent.message").desc("Event type"),
		payload: string().desc("JSON object payload"),
		dedupeKey: string().desc(
			"Stable request retry key; preserve it after an uncertain result",
		),
		replyTo: string().desc("Parent event ID; inherits its causal hop budget"),
		wakeBatch: string().desc("Wake batch ID from the nudge or inbox"),
	},
	run: async ({ ctx, options }) => {
		if (Boolean(options.peer) !== Boolean(options.remoteTeam))
			throw new CLIError("--peer and --remote-team must be provided together");
		let payload: Record<string, unknown> | undefined;
		if (options.payload) {
			try {
				const parsed = JSON.parse(options.payload);
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
					throw new Error();
				payload = parsed;
			} catch {
				throw new CLIError("--payload must be a JSON object");
			}
		}
		const client = await teamworkClient(ctx, options);
		const dedupeKey = options.dedupeKey ?? randomUUID();
		try {
			return {
				data: await client.mail.send.mutate({
					...teamSelection(options),
					targetPeer:
						options.peer && options.remoteTeam
							? { peerId: options.peer, remoteTeamId: options.remoteTeam }
							: undefined,
					to: options.to,
					body: options.body,
					subject: options.subject ?? "",
					type: options.type,
					payload,
					dedupeKey,
					replyTo: options.replyTo,
					wakeBatchId: options.wakeBatch,
				}),
			};
		} catch (error) {
			if (error && typeof error === "object" && "message" in error)
				throw new CLIError(
					String(error.message),
					`Retry only with the same --dedupe-key ${dedupeKey} and unchanged content.`,
				);
			throw error;
		}
	},
});
