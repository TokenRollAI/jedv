import { randomUUID } from "node:crypto";
import { boolean, CLIError, string } from "@jedv/cli-framework";
import { i18n, initI18n } from "@jedv/i18n";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkClient,
	teamworkOptions,
} from "../../../lib/teamwork";

if (!i18n.locale) initI18n();

export default command({
	description:
		"Send durable mail to a member, leader, or Team; reading never implies acknowledgement",
	options: {
		...teamworkOptions(),
		deliveryMode: string()
			.enum("queue", "interrupt")
			.desc(
				i18n._(
					"Delivery mode (default: queue); interrupt requires an explicit human action and safe native support",
				),
			),
		noAck: boolean().desc(
			i18n._(
				"Do not request recipient acknowledgement; this never marks mail acknowledged",
			),
		),
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
		if (options.deliveryMode === "interrupt" && !options.human)
			throw new CLIError(
				i18n._(
					"--delivery-mode interrupt requires --human and an explicit user request",
				),
			);
		if (options.deliveryMode === "interrupt" || options.noAck) {
			const capabilities = await client.team.capabilities.query();
			if (
				!(capabilities.features as Record<string, unknown> | undefined)
					?.mailDeliveryModes
			)
				throw new CLIError(
					i18n._(
						"This Host does not support Mail delivery modes; no mail was sent",
					),
				);
			if (
				options.deliveryMode === "interrupt" &&
				!(capabilities.features as Record<string, unknown> | undefined)
					?.mailInterrupt
			)
				throw new CLIError(
					i18n._(
						"Safe Mail interruption is unavailable on this Host; no mail was sent",
					),
				);
		}
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
					deliveryMode: options.deliveryMode,
					requiresAck: options.noAck ? false : undefined,
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
