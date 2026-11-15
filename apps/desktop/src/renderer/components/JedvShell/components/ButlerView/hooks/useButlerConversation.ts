import type { ButlerSendResult, ButlerTurnContext } from "@jedv/shared/butler";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { butlerQueryKey } from "../../../hooks/useButlerInbox";
import type { JedvParityViewContext } from "../../../parity-types";

type Request = {
	requestId: string;
	humanText: string;
	threadId?: string;
	newTopic: boolean;
	context?: ButlerTurnContext;
};
export type ConversationDraft = {
	text: string;
	pending: boolean;
	failed: boolean;
	request: Request | null;
	context?: ButlerTurnContext;
	reason: ButlerSendResult["reason"];
};
const emptyDraft = (): ConversationDraft => ({
	text: "",
	pending: false,
	failed: false,
	request: null,
	reason: null,
});
const threadKey = (id: string | null) =>
	id ? `thread:${id}` : "current:empty";
const locked = (entry?: ConversationDraft) =>
	!!entry && (!!entry.text || entry.pending || !!entry.request);

export function useButlerConversation({
	context,
	connected,
	supported,
	active,
	historyOpen,
	askContext,
}: {
	context: JedvParityViewContext;
	connected: boolean;
	supported: boolean;
	active: boolean;
	historyOpen: boolean;
	askContext?: { id: number; value?: ButlerTurnContext };
}) {
	const { client, hostUrl } = context;
	const cache = useQueryClient();
	const queryKey = butlerQueryKey(hostUrl);
	const drafts = useRef(new Map<string, ConversationDraft>());
	const [, changed] = useReducer((n: number) => n + 1, 0);
	const [selection, setSelection] = useState<string | null>(null);
	const selected = useRef<string | null>(null);
	const [followDefault, setFollowDefault] = useState(true);
	const [capacityError, setCapacityError] = useState(false);
	const state = useQuery({
		queryKey: [...queryKey, "state"],
		queryFn: () =>
			client.butler.state.query(
				selected.current?.startsWith("thread:")
					? { preferredThreadId: selected.current.slice(7) }
					: {},
			),
		enabled: connected && supported && active,
		retry: false,
		gcTime: 30_000,
		refetchInterval: active ? 5_000 : false,
	});
	const key = selection ?? threadKey(state.data?.currentThreadId ?? null);
	const select = useCallback((next: string, follow: boolean) => {
		selected.current = next;
		setSelection(next);
		setFollowDefault(follow);
	}, []);
	const ensure = useCallback((id: string) => {
		const existing = drafts.current.get(id);
		if (existing) return existing;
		// Keep dirty, in-flight and retry drafts; only empty entries may be evicted.
		if (drafts.current.size >= 32) {
			const clean = [...drafts.current].find(
				([id, entry]) => id !== selected.current && !locked(entry),
			);
			if (!clean) {
				setCapacityError(true);
				return null;
			}
			drafts.current.delete(clean[0]);
		}
		const entry = emptyDraft();
		drafts.current.set(id, entry);
		return entry;
	}, []);
	const draft = drafts.current.get(key) ?? emptyDraft();
	const draftLocked = locked(draft);
	useEffect(() => {
		if (!state.isSuccess) return;
		if (selection === null || (followDefault && !draftLocked)) {
			const next = threadKey(state.data.currentThreadId);
			if (next !== selection) select(next, true);
		}
	}, [
		state.isSuccess,
		state.data?.currentThreadId,
		followDefault,
		selection,
		draftLocked,
		select,
	]);
	const lastContext = useRef<number | null>(null);
	useEffect(() => {
		if (
			!askContext ||
			lastContext.current === askContext.id ||
			!state.isSuccess
		)
			return;
		lastContext.current = askContext.id;
		const entry = ensure(key);
		if (entry && !locked(entry)) {
			entry.context = askContext.value;
			changed();
		}
	}, [askContext, state.isSuccess, key, ensure]);
	const threadId = key.startsWith("thread:") ? key.slice(7) : undefined;
	const history = useQuery({
		queryKey: [...queryKey, "history", threadId],
		queryFn: () => client.butler.history.query({ threadId, limit: 100 }),
		enabled: connected && supported && active && !!threadId,
		retry: false,
		gcTime: 30_000,
		refetchInterval: active ? 5_000 : false,
	});
	const approvals = useQuery({
		queryKey: [...queryKey, "chat-approvals", threadId],
		queryFn: () =>
			client.butler.listApprovals.query({
				threadId,
				status: "all",
				limit: 100,
			}),
		enabled: connected && supported && active && !!threadId,
		retry: false,
		gcTime: 30_000,
		refetchInterval: active ? 5_000 : false,
	});
	const threads = useQuery({
		queryKey: [...queryKey, "threads"],
		queryFn: () =>
			client.butler.listThreads.query({ limit: 50, includeAudit: false }),
		enabled: connected && supported && active && historyOpen,
		retry: false,
		gcTime: 30_000,
	});
	const ai = useQuery({
		queryKey: ["jedv", hostUrl, "ai-settings"],
		queryFn: () => client.aiSettings.get.query(),
		enabled: connected && supported && active,
		retry: false,
		gcTime: 30_000,
	});
	const unavailable =
		!connected || !supported || !state.isSuccess || state.isError;
	const choose = (id: string) => {
		if (!ensure(id)) return;
		setCapacityError(false);
		select(id, false);
	};
	const backToCurrent = () => {
		if (!state.isSuccess) return;
		const next = threadKey(state.data.currentThreadId);
		if (!ensure(next)) return;
		select(next, true);
	};
	const send = async () => {
		const entry = ensure(key);
		if (!entry || entry.pending || unavailable || !entry.text.trim()) return;
		const origin = key;
		const follows =
			followDefault || origin.startsWith("new:") || origin === "current:empty";
		entry.request ??= {
			requestId: crypto.randomUUID(),
			humanText: entry.text,
			...(threadId ? { threadId } : {}),
			newTopic: origin.startsWith("new:"),
			...(entry.context ? { context: entry.context } : {}),
		};
		entry.pending = true;
		entry.failed = false;
		setFollowDefault(false);
		changed();
		let result: ButlerSendResult;
		try {
			result = await client.butler.sendMessage.mutate(entry.request);
		} catch {
			entry.failed = true;
			entry.pending = false;
			changed();
			return;
		}
		entry.text = "";
		entry.request = null;
		entry.context = undefined;
		entry.reason = result.reason;
		const destination = threadKey(result.threadId);
		if (origin !== destination) {
			if (!drafts.current.has(destination))
				drafts.current.set(destination, entry);
			drafts.current.delete(origin);
		}
		// A confirmed send stays confirmed even if the subsequent refresh fails.
		let isCurrent = false;
		try {
			await cache.invalidateQueries({ queryKey });
			const current = await state.refetch({ throwOnError: true });
			isCurrent = current.data?.currentThreadId === result.threadId;
		} catch {}
		if (
			selected.current === origin ||
			(selected.current === null && selection === null)
		)
			select(destination, follows && isCurrent);
		entry.pending = false;
		changed();
	};
	return {
		key,
		threadId,
		draft,
		drafts: drafts.current,
		state,
		history,
		approvals,
		threads,
		ai,
		unavailable,
		capacityError,
		backAvailable:
			!followDefault || key !== threadKey(state.data?.currentThreadId ?? null),
		choose,
		backToCurrent,
		newTopic: () => choose(`new:${crypto.randomUUID()}`),
		setDraft: (text: string) => {
			const entry = ensure(key);
			if (!entry || entry.request) return;
			entry.text = text.slice(0, 12_000);
			changed();
		},
		send,
		refresh: async () => {
			await state.refetch({ throwOnError: true });
			if (threadId)
				await Promise.all([
					history.refetch({ throwOnError: true }),
					approvals.refetch({ throwOnError: true }),
				]);
		},
	};
}
