import { ChatMarkdown } from "@jedv/chat-ui/ChatMarkdown";
import { Trans } from "@lingui/react/macro";
import { nativeHistoryRecords } from "./history";
export function NativeSessionHistory({ data }: { data: unknown }) {
	const history = nativeHistoryRecords(data);
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
