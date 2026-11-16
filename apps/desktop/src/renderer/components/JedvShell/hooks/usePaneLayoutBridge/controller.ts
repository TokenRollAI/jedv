import { i18n } from "@jedv/i18n";
import { msg } from "@lingui/core/macro";
import type {
	PaneLayoutRendererRequest,
	PaneLayoutReply,
} from "main/lib/pane-layout/pane-layout-requests";
import type { TerminalLayoutStore } from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import {
	applyPaneLayoutOperation,
	PaneOperationError,
	validatePaneOperation,
} from "./operations";

export interface LoadedPaneWorkspace {
	store: TerminalLayoutStore;
	sessions: readonly TerminalSession[];
	release(): void;
	flush(): Promise<void>;
}
export function createPaneLayoutController(input: {
	load(workspaceId: string): Promise<LoadedPaneWorkspace>;
	focusWorkspace(workspaceId: string): Promise<void>;
	getSidebarFullScreen?(workspaceId: string): boolean;
	respond(reply: PaneLayoutReply): Promise<unknown>;
	isCurrent(): boolean;
	now?(): number;
	onTransportError?(error: unknown): void;
}) {
	let disposed = false;
	let tail: Promise<void> = Promise.resolve();
	const pending = new Set<string>();
	const replies = new Map<string, PaneLayoutReply>();
	const respond = async (reply: PaneLayoutReply) => {
		try {
			await input.respond(reply);
		} catch (error) {
			input.onTransportError?.(error);
		}
	};
	const check = (request: PaneLayoutRendererRequest) => {
		if (disposed || !input.isCurrent())
			throw new PaneOperationError(
				"PRECONDITION_FAILED",
				i18n._(
					msg({
						message:
							"The local host connection changed. Inspect the layout before retrying.",
					}),
				),
			);
		if ((input.now?.() ?? Date.now()) >= request.expiresAt)
			throw new PaneOperationError(
				"PRECONDITION_FAILED",
				i18n._(
					msg({
						message:
							"The pane request expired. Inspect the layout before retrying.",
					}),
				),
			);
	};
	const errorReply = (
		request: PaneLayoutRendererRequest,
		error: unknown,
	): PaneLayoutReply => ({
		requestId: request.requestId,
		error: {
			code:
				error instanceof PaneOperationError
					? error.code
					: "PRECONDITION_FAILED",
			message:
				error instanceof Error
					? error.message
					: i18n._(
							msg({ message: "The desktop could not apply the pane request." }),
						),
		},
	});
	async function execute(request: PaneLayoutRendererRequest) {
		let loaded: LoadedPaneWorkspace | undefined;
		let reply: PaneLayoutReply;
		try {
			check(request);
			validatePaneOperation(request.op);
			loaded = await input.load(request.workspaceId);
			check(request);
			if (
				request.op.type === "focus" ||
				(request.op.type === "newTab" && request.op.focus !== false) ||
				(request.op.type === "open" && !request.op.background)
			) {
				await input.focusWorkspace(request.workspaceId);
				check(request);
			}
			const result = applyPaneLayoutOperation({
				...loaded,
				op: request.op,
				sidebarFullScreen: input.getSidebarFullScreen?.(request.workspaceId),
			});
			if (request.op.type !== "list") await loaded.flush();
			check(request);
			reply = { requestId: request.requestId, result };
		} catch (error) {
			reply = errorReply(request, error);
		} finally {
			loaded?.release();
		}
		pending.delete(request.requestId);
		if (!disposed) {
			replies.set(request.requestId, reply);
			while (replies.size > 64) {
				const first = replies.keys().next().value;
				if (first) replies.delete(first);
			}
			await respond(reply);
		}
	}
	return {
		enqueue(request: PaneLayoutRendererRequest): Promise<void> {
			if (disposed) return Promise.resolve();
			const previous = replies.get(request.requestId);
			if (previous) return respond(previous);
			if (pending.has(request.requestId)) return tail;
			if (pending.size >= 32)
				return respond(
					errorReply(
						request,
						new PaneOperationError(
							"PRECONDITION_FAILED",
							i18n._(
								msg({
									message:
										"Too many pane requests are waiting. Try again after they finish.",
								}),
							),
						),
					),
				);
			pending.add(request.requestId);
			tail = tail.then(() => execute(request));
			return tail;
		},
		dispose() {
			disposed = true;
			replies.clear();
		},
	};
}
