import type {
	ButlerApprovalShape,
	ButlerTurnContext,
} from "@jedv/shared/butler";
import { Badge } from "@jedv/ui/badge";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import {
	LuArrowLeft,
	LuHistory,
	LuInbox,
	LuPlus,
	LuRefreshCw,
} from "react-icons/lu";
import type { Team } from "../../../../hooks/useTeamwork";
import type { JedvParityViewContext } from "../../../../parity-types";
import { ButlerApprovalCard } from "../../../ButlerDock/components/ButlerApprovalCard";
import { ButlerIcon } from "../../../ButlerIcon";
import { JedvIconButton } from "../../../JedvIconButton";
import {
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "../../../WindowChrome";
import { useButlerConversation } from "../../hooks/useButlerConversation";
import { ButlerChatComposer } from "../ButlerChatComposer";
import { ButlerChatHistory } from "../ButlerChatHistory";
import { ButlerChatMessage } from "../ButlerChatMessage";
export function ButlerChat({
	context,
	connected,
	supported,
	historyByRequest = false,
	active,
	teams,
	actionable,
	pending,
	blocked,
	askContext,
	onResolve,
	onRefresh,
	onSettings,
	onOpenSettings,
	onClose,
}: {
	context: JedvParityViewContext;
	connected: boolean;
	supported: boolean;
	historyByRequest?: boolean;
	active: boolean;
	teams: Team[];
	actionable: number;
	pending: boolean;
	blocked: Set<string>;
	askContext?: { id: number; value?: ButlerTurnContext };
	onResolve(
		approval: ButlerApprovalShape,
		decision: "approve" | "reject",
	): void;
	onRefresh(): Promise<void>;
	onSettings(): void;
	onOpenSettings?: () => void;
	onClose(): void;
}) {
	const { t } = useLingui();
	const [historyOpen, setHistoryOpen] = useState(false);
	const chat = useButlerConversation({
		context,
		connected,
		supported,
		active,
		historyOpen,
		historyByRequest,
		askContext,
	});
	const scroll = useRef<HTMLDivElement>(null);
	const nearBottom = useRef(true);
	const previousKey = useRef(chat.key);
	useEffect(() => {
		const switched = previousKey.current !== chat.key;
		previousKey.current = chat.key;
		if (switched) nearBottom.current = true;
		if (
			(switched ||
				chat.history.data ||
				chat.approvals.data ||
				chat.draft.pending) &&
			nearBottom.current &&
			scroll.current
		)
			scroll.current.scrollTop = scroll.current.scrollHeight;
	}, [chat.key, chat.history.data, chat.approvals.data, chat.draft.pending]);
	const messages = chat.historyRequested ? (chat.history.data ?? []) : [];
	const approvals = chat.threadId ? (chat.approvals.data ?? []) : [];
	const timeline = [
		...messages.map((message) => ({
			type: "message" as const,
			id: message.id,
			time: message.createdAt,
			message,
		})),
		...approvals.map((approval) => ({
			type: "approval" as const,
			id: approval.id,
			time: approval.createdAt,
			approval,
		})),
	].sort(
		(a, b) =>
			a.time - b.time ||
			(a.type === b.type ? 0 : a.type === "message" ? -1 : 1),
	);
	const fault =
		chat.unavailable ||
		(chat.historyRequested && chat.history.isError) ||
		(chat.threadId && chat.approvals.isError);
	return (
		<>
			<WindowChrome primary className="gap-2 border-b border-border pr-3">
				<WindowChromeLeading />
				<WindowChromeControls className="pl-3">
					<JedvIconButton label={t({ message: "Back" })} onClick={onClose}>
						<LuArrowLeft className="size-4" />
					</JedvIconButton>
					<h1 className="flex items-center gap-2 text-[13px] font-medium">
						<ButlerIcon className="size-4 text-muted-foreground" />
						<Trans>Butler</Trans>
					</h1>
				</WindowChromeControls>
				<div className="drag min-w-0 flex-1" />
				<WindowChromeControls>
					<JedvIconButton
						label={t({
							message: "Pending approvals and unread important faults",
						})}
						onClick={onClose}
						className="w-auto gap-1.5 px-2.5"
					>
						<LuInbox className="size-4" />
						{actionable > 0 && (
							<Badge variant="secondary" className="h-4 px-1 text-[10px]">
								{actionable}
							</Badge>
						)}
					</JedvIconButton>
					<JedvIconButton
						label={t({ message: "History" })}
						onClick={() => setHistoryOpen(true)}
						disabled={!connected || !supported}
					>
						<LuHistory className="size-4" />
					</JedvIconButton>
					<JedvIconButton
						label={t({ message: "New topic" })}
						onClick={chat.newTopic}
						disabled={chat.unavailable}
					>
						<LuPlus className="size-4" />
					</JedvIconButton>
					<JedvIconButton
						label={t({ message: "Refresh" })}
						onClick={() =>
							void (async () => {
								try {
									await chat.refresh();
									await onRefresh();
								} catch {}
							})()
						}
						disabled={!connected || !supported}
					>
						<LuRefreshCw className="size-3.5" />
					</JedvIconButton>
				</WindowChromeControls>
				<WindowControlsInset />
			</WindowChrome>
			{chat.backAvailable && (
				<div className="mx-auto flex w-full max-w-[792px] shrink-0 px-4 pt-2">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 gap-1.5 text-xs text-muted-foreground"
						disabled={chat.unavailable}
						onClick={chat.backToCurrent}
					>
						<LuArrowLeft className="size-3.5" />
						<Trans>Back to current conversation</Trans>
					</Button>
				</div>
			)}
			{fault && (
				<p
					role="alert"
					className="mx-auto w-full max-w-[792px] px-4 py-2 text-xs text-destructive"
				>
					<Trans>
						Conversation state is unavailable. Refresh or update the host.
					</Trans>
				</p>
			)}
			{chat.capacityError && (
				<p role="alert" className="px-4 text-xs text-destructive">
					<Trans>Unavailable</Trans>
				</p>
			)}
			<div
				ref={scroll}
				className="min-h-0 flex-1 overflow-y-auto"
				onScroll={() => {
					const el = scroll.current;
					if (el)
						nearBottom.current =
							el.scrollHeight - el.scrollTop - el.clientHeight < 80;
				}}
			>
				<div
					className="mx-auto w-full max-w-[792px] space-y-5 px-4 py-6"
					aria-live="polite"
				>
					{(chat.state.isPending ||
						(chat.historyRequested && chat.history.isPending)) &&
						connected &&
						supported && (
							<output className="text-xs text-muted-foreground">
								<Trans>Loading…</Trans>
							</output>
						)}
					{timeline.map((item) =>
						item.type === "message" ? (
							<ButlerChatMessage
								key={`message:${item.id}`}
								message={item.message}
							/>
						) : (
							<ButlerApprovalCard
								key={`approval:${item.id}`}
								approval={item.approval}
								teams={teams}
								workspaces={context.workspaces}
								pending={pending || chat.unavailable || chat.approvals.isError}
								blocked={blocked.has(`approval:${item.id}`)}
								onResolve={(decision) => onResolve(item.approval, decision)}
							/>
						),
					)}
					{chat.draft.pending && (
						<output className="block text-xs text-muted-foreground">
							<Trans>Sending…</Trans>
						</output>
					)}
				</div>
			</div>
			<ButlerChatComposer
				client={context.client}
				draft={chat.draft}
				disabled={!!fault}
				noKey={chat.ai.data?.configured === false}
				onChange={chat.setDraft}
				onSend={chat.send}
				onSettings={onSettings}
				onOpenSettings={onOpenSettings}
			/>
			{historyOpen && (
				<ButlerChatHistory
					threads={chat.threads.data ?? []}
					drafts={chat.drafts}
					loading={chat.threads.isPending}
					failed={chat.threads.isError}
					onChoose={(key) => {
						chat.choose(key);
						setHistoryOpen(false);
					}}
					onClose={() => setHistoryOpen(false)}
				/>
			)}
		</>
	);
}
