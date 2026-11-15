import { formatDateTime } from "@jedv/i18n/format";
import type { ButlerMessageShape } from "@jedv/shared/butler";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@jedv/ui/ai-elements/message";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuWrench } from "react-icons/lu";
import { ButlerIcon } from "../../../ButlerIcon";
import { ButlerMarkdownLink } from "./components/ButlerMarkdownLink";
import { ButlerMarkdownContext } from "./markdown-context";

const components = { a: ButlerMarkdownLink };
const disallowedElements = [
	"script",
	"style",
	"iframe",
	"object",
	"embed",
	"form",
	"input",
	"button",
	"textarea",
	"select",
	"option",
];
export function ButlerChatMessage({
	message,
	onOpenUrl,
}: {
	message: ButlerMessageShape;
	onOpenUrl?: (url: string) => Promise<void>;
}) {
	const { t } = useLingui();
	if (message.role === "tool")
		return (
			<details className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
				<summary className="flex cursor-pointer items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<LuWrench className="size-3.5" />
					<Trans>Tool output</Trans>
				</summary>
				<pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
					{message.content}
				</pre>
			</details>
		);
	const human = message.role === "human";
	const content = human ? (
		<p className="whitespace-pre-wrap break-words">{message.content}</p>
	) : (
		<MessageResponse
			mode="static"
			animated={false}
			isAnimating={false}
			skipHtml
			disallowedElements={disallowedElements}
			components={components}
		>
			{message.content}
		</MessageResponse>
	);
	return (
		<Message from={human ? "user" : "assistant"} className="gap-1.5">
			<div
				className={`flex items-center gap-1.5 text-[11px] text-muted-foreground ${human ? "justify-end" : ""}`}
			>
				{!human && <ButlerIcon className="size-3.5" />}
				<span>{human ? t({ message: "You" }) : t({ message: "Butler" })}</span>
				<time
					dateTime={new Date(message.createdAt).toISOString()}
					title={formatDateTime(message.createdAt)}
					className="sr-only"
				>
					{formatDateTime(message.createdAt)}
				</time>
			</div>
			<MessageContent
				className={
					human
						? "max-w-[85%] text-[13px] leading-relaxed"
						: "text-sm leading-relaxed"
				}
			>
				{onOpenUrl ? (
					<ButlerMarkdownContext value={onOpenUrl}>
						{content}
					</ButlerMarkdownContext>
				) : (
					content
				)}
			</MessageContent>
		</Message>
	);
}
