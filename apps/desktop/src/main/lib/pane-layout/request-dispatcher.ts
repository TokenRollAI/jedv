import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { i18n } from "@jedv/i18n";
import type {
	PaneLayoutErrorCode,
	PaneLayoutOp,
	PaneLayoutOpResult,
} from "@jedv/shared/pane-layout-ops";
import { msg } from "@lingui/core/macro";

const REPLY_TIMEOUT_MS = 10_000;
const MAX_PENDING = 64;
const MAX_SUBSCRIPTIONS = 128;
const STATUS_BY_CODE: Record<PaneLayoutErrorCode, number> = {
	NOT_FOUND: 404,
	BAD_REQUEST: 400,
	PRECONDITION_FAILED: 412,
};
export type RendererPaneLayoutOp =
	| PaneLayoutOp
	| { type: "wakeBrowser"; paneId: string };
export interface PaneLayoutRendererRequest {
	requestId: string;
	workspaceId: string;
	op: RendererPaneLayoutOp;
	targetWebContentsId: number;
	targetSubscriptionId: string;
	expiresAt: number;
}
export interface PaneLayoutReply {
	requestId: string;
	result?: PaneLayoutOpResult;
	error?: { code?: PaneLayoutErrorCode; message: string };
}
export class PaneLayoutRequestError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}
interface PendingRequest {
	targetWebContentsId: number;
	targetSubscriptionId: string;
	resolve(result: PaneLayoutOpResult): void;
	reject(error: PaneLayoutRequestError): void;
	cancelTimer(): void;
}
export class PaneLayoutRequests extends EventEmitter {
	private readonly subscribers = new Map<number, Set<string>>();
	private readonly workspaces = new Map<number, string | null>();
	private readonly pending = new Map<string, PendingRequest>();
	constructor(
		private readonly environment: {
			focusedWindowId(): number | null;
			isAlive(webContentsId: number): boolean;
			now?(): number;
			schedule?(callback: () => void, ms: number): () => void;
		},
	) {
		super();
		this.setMaxListeners(MAX_SUBSCRIPTIONS);
	}
	addSubscriber(webContentsId: number): {
		subscriptionId: string;
		unsubscribe(): void;
	} {
		if (
			[...this.subscribers.values()].reduce((n, ids) => n + ids.size, 0) >=
			MAX_SUBSCRIPTIONS
		)
			throw new PaneLayoutRequestError(
				503,
				i18n._(msg({ message: "Too many desktop pane subscriptions." })),
			);
		const token = randomUUID(),
			tokens = this.subscribers.get(webContentsId) ?? new Set<string>();
		tokens.add(token);
		this.subscribers.set(webContentsId, tokens);
		let released = false;
		return {
			subscriptionId: token,
			unsubscribe: () => {
				if (released) return;
				released = true;
				tokens.delete(token);
				if (!tokens.size) {
					this.subscribers.delete(webContentsId);
					this.workspaces.delete(webContentsId);
				}
				for (const [requestId, request] of this.pending) {
					if (request.targetSubscriptionId !== token) continue;
					this.pending.delete(requestId);
					request.cancelTimer();
					request.reject(
						new PaneLayoutRequestError(
							503,
							i18n._(
								msg({
									message:
										"The desktop pane connection closed before the layout result was confirmed.",
								}),
							),
						),
					);
				}
			},
		};
	}
	setWorkspace(webContentsId: number, workspaceId: string | null): void {
		if (this.subscribers.has(webContentsId))
			this.workspaces.set(webContentsId, workspaceId);
	}
	private pickTarget(workspaceId: string): number | null {
		const alive = [...this.subscribers.keys()].filter((id) =>
			this.environment.isAlive(id),
		);
		const showing = alive.filter(
			(id) => this.workspaces.get(id) === workspaceId,
		);
		const eligible = showing.length ? showing : alive;
		const focused = this.environment.focusedWindowId();
		return focused !== null && eligible.includes(focused)
			? focused
			: (eligible[0] ?? null);
	}
	request(
		workspaceId: string,
		op: RendererPaneLayoutOp,
	): Promise<PaneLayoutOpResult> {
		if (this.pending.size >= MAX_PENDING)
			return Promise.reject(
				new PaneLayoutRequestError(
					503,
					i18n._(
						msg({
							message:
								"Too many pending pane requests. Wait for the current requests to finish.",
						}),
					),
				),
			);
		const targetWebContentsId = this.pickTarget(workspaceId);
		if (targetWebContentsId === null)
			return Promise.reject(
				new PaneLayoutRequestError(
					503,
					i18n._(
						msg({
							message: "No desktop window is open to apply the layout change.",
						}),
					),
				),
			);
		const targetSubscriptionId = this.subscribers
			.get(targetWebContentsId)
			?.values()
			.next().value;
		if (!targetSubscriptionId)
			return Promise.reject(
				new PaneLayoutRequestError(
					503,
					i18n._(msg({ message: "No desktop pane consumer is connected." })),
				),
			);
		const requestId = randomUUID();
		return new Promise((resolve, reject) => {
			const expire = () => {
				this.pending.delete(requestId);
				reject(
					new PaneLayoutRequestError(
						504,
						i18n._(
							msg({
								message:
									"The desktop app did not confirm the layout change in time. Inspect the layout before retrying.",
							}),
						),
					),
				);
			};
			const cancelTimer = this.environment.schedule
				? this.environment.schedule(expire, REPLY_TIMEOUT_MS)
				: (() => {
						const timer = setTimeout(expire, REPLY_TIMEOUT_MS);
						return () => clearTimeout(timer);
					})();
			this.pending.set(requestId, {
				targetWebContentsId,
				targetSubscriptionId,
				resolve,
				reject,
				cancelTimer,
			});
			this.emit("request", {
				requestId,
				workspaceId,
				op,
				targetWebContentsId,
				targetSubscriptionId,
				expiresAt: (this.environment.now?.() ?? Date.now()) + REPLY_TIMEOUT_MS,
			} satisfies PaneLayoutRendererRequest);
		});
	}
	respond(reply: PaneLayoutReply, senderWebContentsId: number | null): void {
		const pending = this.pending.get(reply.requestId);
		if (!pending || pending.targetWebContentsId !== senderWebContentsId) return;
		this.pending.delete(reply.requestId);
		pending.cancelTimer();
		if (reply.result) pending.resolve(reply.result);
		else
			pending.reject(
				new PaneLayoutRequestError(
					reply.error?.code ? STATUS_BY_CODE[reply.error.code] : 500,
					reply.error?.message ??
						i18n._(msg({ message: "The layout change failed." })),
				),
			);
	}
}
