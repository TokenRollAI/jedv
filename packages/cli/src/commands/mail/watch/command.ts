import { CLIError, number, string } from "@jedv/cli-framework";
import { command } from "../../../lib/command";
import {
	teamSelection,
	teamworkOptions,
	teamworkTarget,
} from "../../../lib/teamwork";

export default command({
	description:
		"Stream current and newly arriving mail as JSON lines over the host event WebSocket",
	options: {
		...teamworkOptions(),
		member: string().desc("Recipient member name or ID for human access"),
		agent: string().desc("Alias for recipient member name or ID"),
		status: string()
			.enum("unread", "all")
			.default("unread")
			.desc("Unacknowledged or all mail"),
		limit: number()
			.int()
			.min(1)
			.max(500)
			.default(100)
			.desc("Deliveries per page"),
		after: string().desc("Resume after this delivery cursor"),
		timeout: number()
			.min(0)
			.max(86400)
			.default(600)
			.desc("Maximum watch duration in seconds; Ctrl-C detaches"),
	},
	run: async ({ ctx, options, signal }) => {
		const target = await teamworkTarget(ctx, options);
		const selected = await target.client.team.status.query(
			teamSelection(options),
		);
		const input = {
			...teamSelection(options),
			teamId: selected.team.id,
			member: options.member ?? options.agent,
			includeAcked: options.status === "all",
			limit: options.limit,
		};
		const stop = AbortSignal.any([
			signal,
			AbortSignal.timeout(Math.ceil(options.timeout * 1000)),
		]);
		const ws = new WebSocket(
			`${target.ws.baseWsUrl}/events?token=${encodeURIComponent(target.ws.token)}`,
		);
		let revision = 0,
			resume: (() => void) | undefined,
			closed = false;
		const changed = () => {
			revision++;
			resume?.();
		};
		ws.addEventListener("message", (event) => {
			try {
				const message = JSON.parse(String(event.data));
				if (
					message.type === "mail:changed" &&
					message.teamId === selected.team.id
				)
					changed();
			} catch {}
		});
		ws.addEventListener("close", () => {
			closed = true;
			changed();
		});
		stop.addEventListener("abort", changed, { once: true });
		try {
			await new Promise<void>((resolve, reject) => {
				const abort = () => resolve();
				ws.addEventListener(
					"open",
					() => {
						stop.removeEventListener("abort", abort);
						resolve();
					},
					{ once: true },
				);
				ws.addEventListener(
					"error",
					() => {
						stop.removeEventListener("abort", abort);
						reject(
							new CLIError(
								"Mail event WebSocket failed; reconnect with --after <last-delivery-id>",
							),
						);
					},
					{ once: true },
				);
				stop.addEventListener("abort", abort, { once: true });
			});
			let cursor = options.after;
			do {
				const seen = revision;
				const result = await target.client.mail.inbox.query(
					{ ...input, after: cursor },
					{ signal },
				);
				for (const item of result.items)
					await new Promise<void>((resolve, reject) =>
						process.stdout.write(`${JSON.stringify(item)}\n`, (error) =>
							error ? reject(error) : resolve(),
						),
					);
				cursor = result.cursor ?? cursor;
				if (stop.aborted) break;
				if (closed)
					throw new CLIError(
						"Mail event WebSocket closed",
						`Reconnect with --after ${cursor ?? "<last-delivery-id>"}; no mail was acknowledged.`,
					);
				if (result.items.length === options.limit || revision !== seen)
					continue;
				await new Promise<void>((resolve) => {
					resume = resolve;
					if (revision !== seen || stop.aborted || closed) resolve();
				});
				resume = undefined;
			} while (!stop.aborted);
		} finally {
			stop.removeEventListener("abort", changed);
			ws.close();
		}
	},
});
