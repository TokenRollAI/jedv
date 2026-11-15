import type { ButlerThreadShape } from "@jedv/shared/butler";
import { Badge } from "@jedv/ui/badge";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@jedv/ui/command";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ConversationDraft } from "../../hooks/useButlerConversation";
export function ButlerChatHistory({
	threads,
	drafts,
	loading,
	failed,
	onChoose,
	onClose,
}: {
	threads: ButlerThreadShape[];
	drafts: Map<string, ConversationDraft>;
	loading: boolean;
	failed: boolean;
	onChoose(key: string): void;
	onClose(): void;
}) {
	const { t } = useLingui();
	const unsent = [...drafts].filter(
		([key, entry]) =>
			!key.startsWith("thread:") && (!!entry.text || entry.pending),
	);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-w-lg" aria-describedby={undefined}>
				<DialogHeader>
					<DialogTitle>
						<Trans>History</Trans>
					</DialogTitle>
				</DialogHeader>
				{failed && (
					<p role="alert" className="text-xs text-destructive">
						<Trans>Unavailable</Trans>
					</p>
				)}
				{loading && (
					<output className="text-xs text-muted-foreground">
						<Trans>Loading…</Trans>
					</output>
				)}
				<Command>
					<CommandInput placeholder={t({ message: "Search" })} />
					<CommandList className="max-h-[min(60vh,400px)]">
						<CommandEmpty>
							<Trans>No items</Trans>
						</CommandEmpty>
						{unsent.map(([key, entry]) => (
							<CommandItem
								key={key}
								value={`${key} ${entry.text}`}
								onSelect={() => onChoose(key)}
							>
								<span className="min-w-0 flex-1 truncate" title={entry.text}>
									{entry.text || t({ message: "New topic" })}
								</span>
								<Badge variant="secondary">
									<Trans>Draft</Trans>
								</Badge>
							</CommandItem>
						))}
						{threads.map((thread) => (
							<CommandItem
								key={thread.id}
								value={`${thread.id} ${thread.title}`}
								onSelect={() => onChoose(`thread:${thread.id}`)}
							>
								<span className="min-w-0 flex-1 truncate" title={thread.title}>
									{thread.title}
								</span>
								{drafts.get(`thread:${thread.id}`)?.text && (
									<Badge variant="secondary">
										<Trans>Draft</Trans>
									</Badge>
								)}
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
