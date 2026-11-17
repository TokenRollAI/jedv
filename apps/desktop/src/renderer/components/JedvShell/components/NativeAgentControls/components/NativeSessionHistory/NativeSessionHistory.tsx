import { ChatMarkdown } from "@jedv/chat-ui/ChatMarkdown";
import { Trans } from "@lingui/react/macro";
import { LuMessageSquare } from "react-icons/lu";
import { AgentIcon } from "renderer/components/AgentIcon";
import { nativeHistoryRecords } from "./history";

export function NativeSessionHistory({
	data,
	variant = "compact",
	presetId,
	working = false,
}: {
	data: unknown;
	variant?: "compact" | "conversation";
	presetId?: string;
	working?: boolean;
}) {
	const history = nativeHistoryRecords(data);
	if (variant === "conversation") {
		const lastRecord = history.records.at(-1);
		const awaitingAgentTurn =
			working &&
			(history.records.length === 0 ||
				(!!lastRecord &&
					["user_message", "userMessage"].includes(lastRecord.role)));
		return (
			<div className="space-y-5 text-[13.5px]">
				{history.records.length === 0 && !working ? (
					<div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-xs text-muted-foreground">
						<LuMessageSquare className="size-6 text-muted-foreground/50" />
						<p>
							<Trans>No messages in this page</Trans>
						</p>
					</div>
				) : (
					history.records.map((record) => {
						const isUser = ["user_message", "userMessage"].includes(
							record.role,
						);
						const isAgent = ["agent_message", "agentMessage"].includes(
							record.role,
						);
						if (isUser) {
							return (
								<article
									key={record.id}
									className="flex flex-col items-end gap-1"
								>
									<span className="px-1 text-[11px] font-medium text-muted-foreground">
										<Trans>You</Trans>
									</span>
									<div className="max-w-[85%] rounded-2xl bg-foreground/[0.06] px-4 py-2.5 text-[13.5px] leading-relaxed text-foreground ring-1 ring-border/60">
										<ChatMarkdown complete>{record.text}</ChatMarkdown>
									</div>
								</article>
							);
						}
						if (isAgent) {
							return (
								<article key={record.id} className="space-y-2">
									<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
										{presetId && (
											<AgentIcon
												presetId={presetId}
												className="size-3.5 shrink-0"
											/>
										)}
										<Trans>Agent</Trans>
									</div>
									<div className="rounded-xl border border-border/60 bg-card/50 px-4 py-3 text-[13.5px] leading-relaxed text-foreground">
										<ChatMarkdown complete>{record.text}</ChatMarkdown>
									</div>
								</article>
							);
						}
						return (
							<article
								key={record.id}
								className="space-y-1.5 rounded-xl border border-border/60 bg-card/60 px-3.5 py-2.5 text-xs"
							>
								<p className="text-[11px] font-medium text-muted-foreground">
									<Trans>Tool output</Trans>
								</p>
								<ChatMarkdown complete>{record.text}</ChatMarkdown>
							</article>
						);
					})
				)}
				{awaitingAgentTurn && (
					<div className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card/45 px-3.5 py-2 text-xs text-muted-foreground">
						{presetId && (
							<AgentIcon
								presetId={presetId}
								className="size-3.5 shrink-0 opacity-85"
							/>
						)}
						<span className="size-1.5 animate-pulse rounded-full bg-chart-1" />
						<span>
							<Trans>Working</Trans>…
						</span>
					</div>
				)}
			</div>
		);
	}
	return (
		<div className="space-y-3 text-xs">
			{history.source === "control-projection" && (
				<p className="text-muted-foreground">
					<Trans>
						Control output only. Earlier CLI history is not included.
					</Trans>
				</p>
			)}
			{history.records.length === 0 ? (
				<p className="text-muted-foreground">
					<Trans>No messages in this page</Trans>
				</p>
			) : (
				history.records.map((record) => (
					<article
						key={record.id}
						className="space-y-1 border-t border-border pt-2"
					>
						<p className="text-[10px] font-medium text-muted-foreground">
							{["user_message", "userMessage"].includes(record.role) ? (
								<Trans>You</Trans>
							) : ["agent_message", "agentMessage"].includes(record.role) ? (
								<Trans>Agent</Trans>
							) : (
								<Trans>Tool output</Trans>
							)}
						</p>
						<ChatMarkdown complete>{record.text}</ChatMarkdown>
					</article>
				))
			)}
		</div>
	);
}
