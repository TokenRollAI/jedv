import type { DurableEvent } from "@jedv/chat/protocol";
import type {
	CodexNotification,
	CodexServerRequest,
	HarnessAdapter,
} from "@jedv/chat-runtime";
import { TRPCError } from "@trpc/server";
import {
	chatApprovalDetail,
	codexApprovalDetail,
	codexItemApprovalDetail,
	type NativeApprovalDetail,
} from "./approval-detail";
import { CodexDaemonManager, type SharedCodexDaemon } from "./codexDaemon";

export type NativeProvider = "codex" | "claude" | "agy" | "kimi";
export type NativeIdentity = {
	workspaceId: string;
	provider: NativeProvider;
	profileHash: string;
	nativeSessionId: string;
};

export type NativeControlCapability = {
	provider: NativeProvider;
	supported: boolean;
	controlMode: "shared-daemon" | "quiesced-resume" | "unsupported";
	verification: string;
	reason?: string;
};

export const controlCapabilities = (): NativeControlCapability[] => [
	{
		provider: "codex" as const,
		supported: true,
		controlMode: "shared-daemon" as const,
		verification: "shared-service-probed" as const,
	},
	{
		provider: "claude" as const,
		supported: true,
		controlMode: "quiesced-resume" as const,
		verification: "native-uuid-initialization-probed" as const,
	},
	{
		provider: "agy" as const,
		supported: true,
		controlMode: "quiesced-resume" as const,
		verification: "protocol-negotiated" as const,
		reason:
			"ACP load/resume negotiated on 1.5.8; authenticated CLI/ACP same-ID round trip remains unverified",
	},
	{
		provider: "kimi" as const,
		supported: true,
		controlMode: "quiesced-resume" as const,
		verification: "protocol-negotiated" as const,
		reason:
			"ACP load/resume negotiated on 2.6.2; isolated session/new requires authentication",
	},
];

export type NativeControlState = NativeIdentity & {
	cwd: string;
	terminalId: string | null;
	chatSessionId: string | null;
	activeWriter: "cli" | "control" | "none";
	leaseEpoch: number;
	turnState: "idle" | "running" | "awaiting-approval" | "unknown";
	turnId: string | null;
	pendingApprovals: {
		requestId: string;
		method: string;
		detail?: NativeApprovalDetail;
	}[];
};

type Entry = NativeControlState & {
	daemon?: SharedCodexDaemon;
	approvals: Map<string, CodexServerRequest>;
	approvalItems: Map<string, NativeApprovalDetail>;
	controlIntent: boolean;
	loadingChatId?: string;
	writePermitted?: boolean;
};

const keyOf = (identity: NativeIdentity) =>
	JSON.stringify([
		identity.workspaceId,
		identity.provider,
		identity.profileHash,
		identity.nativeSessionId,
	]);

export class SessionControlBroker {
	private readonly entries = new Map<string, Entry>();
	private readonly launchConfigurations = new Map<string, string>();
	private readonly changing = new Set<string>();
	private epoch = Date.now();
	readonly daemons = new CodexDaemonManager({
		notification: (workspace, profile, event) =>
			this.notification(workspace, profile, event),
		request: (workspace, profile, event) =>
			this.request(workspace, profile, event),
		exit: (workspace, profile) => {
			for (const entry of this.entries.values())
				if (entry.workspaceId === workspace && entry.profileHash === profile) {
					entry.activeWriter = "none";
					entry.turnState = "unknown";
					entry.leaseEpoch = ++this.epoch;
				}
		},
	});

	register(
		identity: NativeIdentity,
		cwd: string,
		daemon?: SharedCodexDaemon,
		configurationKey?: string,
	): NativeControlState {
		const key = keyOf(identity);
		if (configurationKey) {
			const previous = this.launchConfigurations.get(key);
			if (previous && previous !== configurationKey)
				throw new TRPCError({
					code: "CONFLICT",
					message:
						"This native session already uses another launch configuration; its current writer was preserved",
				});
			this.launchConfigurations.set(key, configurationKey);
		}
		const existing = this.entries.get(key);
		if (existing) {
			if (daemon) existing.daemon = daemon;
			return this.snapshot(existing);
		}
		const entry: Entry = {
			...identity,
			cwd,
			terminalId: null,
			chatSessionId: null,
			activeWriter: "none",
			leaseEpoch: ++this.epoch,
			turnState: "idle",
			turnId: null,
			pendingApprovals: [],
			approvals: new Map(),
			approvalItems: new Map(),
			controlIntent: false,
			daemon,
		};
		this.entries.set(key, entry);
		return this.snapshot(entry);
	}

	state(identity: NativeIdentity): NativeControlState {
		return this.snapshot(this.require(identity));
	}
	setTurnState(
		identity: NativeIdentity,
		state: NativeControlState["turnState"],
	): void {
		this.require(identity).turnState = state;
	}

	bindCli(identity: NativeIdentity, terminalId: string): NativeControlState {
		const entry = this.require(identity);
		entry.terminalId = terminalId;
		entry.activeWriter = "cli";
		entry.leaseEpoch = ++this.epoch;
		return this.snapshot(entry);
	}

	async claim(
		identity: NativeIdentity,
		epoch: number,
		cliRunning: () => Promise<boolean>,
		start?: () => Promise<string>,
	): Promise<NativeControlState> {
		return this.exclusive(identity, async (entry) => {
			this.checkEpoch(entry, epoch);
			if (entry.turnState !== "idle")
				throw new TRPCError({
					code: "CONFLICT",
					message:
						"Agent is busy or disconnected; finish its work before claiming Control",
				});
			if (await cliRunning())
				throw new TRPCError({
					code: "CONFLICT",
					message:
						"Exit the native CLI or explicitly close its terminal before claiming Control",
				});
			this.checkEpoch(entry, epoch);
			try {
				if (start) entry.chatSessionId = await start();
			} finally {
				entry.loadingChatId = undefined;
			}
			this.checkEpoch(entry, epoch);
			entry.activeWriter = "control";
			entry.leaseEpoch = ++this.epoch;
			return this.snapshot(entry);
		});
	}

	async open(
		identity: NativeIdentity,
		epoch: number,
		launch: (state: NativeControlState) => Promise<string>,
	): Promise<NativeControlState> {
		return this.exclusive(identity, async (entry) => {
			this.checkEpoch(entry, epoch);
			if (entry.turnState !== "idle")
				throw new TRPCError({
					code: "CONFLICT",
					message: "Agent is busy; finish its work before opening CLI",
				});
			const terminalId = await launch(this.snapshot(entry));
			this.checkEpoch(entry, epoch);
			return this.bindCli(identity, terminalId);
		});
	}

	async control(
		identity: NativeIdentity,
		epoch: number,
		action:
			| { type: "prompt"; text: string }
			| { type: "interrupt" }
			| { type: "approve"; requestId: string; decision: "accept" | "decline" },
	): Promise<NativeControlState> {
		return this.withControl(identity, epoch, async () => {
			const entry = this.require(identity);
			const client = entry.daemon?.client;
			if (!client)
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message:
						"Use the existing Chat session command API for this provider",
				});
			if (action.type === "prompt") {
				if (entry.turnState !== "idle")
					throw new TRPCError({ code: "CONFLICT", message: "Agent is busy" });
				entry.controlIntent = true;
				entry.turnState = "running";
				try {
					await client.request("turn/start", {
						threadId: entry.nativeSessionId,
						input: [{ type: "text", text: action.text, text_elements: [] }],
					});
				} catch (error) {
					entry.controlIntent = false;
					entry.turnState = "unknown";
					throw error;
				}
			} else if (action.type === "interrupt") {
				if (entry.turnId)
					await client.request("turn/interrupt", {
						threadId: entry.nativeSessionId,
						turnId: entry.turnId,
					});
			} else {
				const request = entry.approvals.get(action.requestId);
				if (!request)
					throw new TRPCError({
						code: "CONFLICT",
						message:
							"Approval was already resolved or belongs to another session",
					});
				entry.approvals.delete(action.requestId);
				client.respond(request.id, { decision: action.decision });
				entry.pendingApprovals = entry.pendingApprovals.filter(
					(approval) => approval.requestId !== action.requestId,
				);
			}
			return this.snapshot(entry);
		});
	}

	async withControl<T>(
		identity: NativeIdentity,
		epoch: number,
		write: (state: NativeControlState) => Promise<T>,
	): Promise<T> {
		return this.exclusive(identity, async (entry) => {
			this.checkEpoch(entry, epoch);
			if (entry.activeWriter !== "control")
				throw new TRPCError({
					code: "CONFLICT",
					message: "Control does not own this native session",
				});
			entry.writePermitted = true;
			try {
				return await write(entry);
			} finally {
				entry.writePermitted = false;
			}
		});
	}

	authorizeControlLoad(identity: NativeIdentity, chatSessionId: string): void {
		this.require(identity).loadingChatId = chatSessionId;
	}

	chatEvent(chatSessionId: string, event: DurableEvent): void {
		const entry = [...this.entries.values()].find(
			(entry) =>
				entry.chatSessionId === chatSessionId ||
				entry.loadingChatId === chatSessionId,
		);
		if (!entry || entry.provider === "codex") return;
		if (event.type === "turn") {
			entry.turnId = event.turn.status === "running" ? event.turn.id : null;
			entry.turnState = event.turn.status === "running" ? "running" : "idle";
		} else if (
			event.type === "item" &&
			event.item.kind === "approval_request"
		) {
			const approval = event.item as {
				id: string;
				status: string;
				title: string;
			};
			entry.pendingApprovals = entry.pendingApprovals.filter(
				(request) => request.requestId !== approval.id,
			);
			if (approval.status === "pending")
				entry.pendingApprovals.push({
					requestId: approval.id,
					method: approval.title,
					detail: chatApprovalDetail(event.item),
				});
			entry.turnState = entry.pendingApprovals.length
				? "awaiting-approval"
				: entry.turnId
					? "running"
					: "idle";
		} else if (
			event.type === "session" &&
			event.session.status === "dead" &&
			!this.changing.has(keyOf(entry))
		) {
			entry.activeWriter = "none";
			entry.turnState = "unknown";
			entry.leaseEpoch = ++this.epoch;
		}
	}

	guardHarnessAdapter(
		adapter: HarnessAdapter,
		workspaceId: string,
		chatSessionId: string,
		requestedId?: string,
	): HarnessAdapter {
		let nativeId = requestedId;
		const find = () =>
			[...this.entries.values()].find(
				(entry) =>
					entry.workspaceId === workspaceId &&
					entry.nativeSessionId === nativeId,
			);
		const broker = this;
		return new Proxy(adapter, {
			get(target, property) {
				if (property === "start")
					return (options: Parameters<HarnessAdapter["start"]>[0]) => ({
						async *[Symbol.asyncIterator]() {
							await Promise.resolve();
							const entry = find();
							if (
								entry &&
								(broker.changing.has(keyOf(entry)) ||
									entry.activeWriter === "cli") &&
								entry.loadingChatId !== chatSessionId
							)
								throw new TRPCError({
									code: "CONFLICT",
									message: "Claim native Control before starting this adapter",
								});
							for await (const event of target.start(options)) {
								if (event.kind === "session" && event.session.harnessSessionId)
									nativeId = event.session.harnessSessionId;
								yield event;
							}
						},
					});
				const value = Reflect.get(target, property, target);
				if (typeof value !== "function") return value;
				if (
					[
						"prompt",
						"steer",
						"setMode",
						"setConfigOption",
						"respondToApproval",
						"cancelTurn",
					].includes(String(property))
				)
					return (...args: unknown[]) => {
						const entry = find();
						if (
							entry &&
							(entry.activeWriter !== "control" ||
								(broker.changing.has(keyOf(entry)) && !entry.writePermitted))
						)
							throw new TRPCError({
								code: "CONFLICT",
								message: "Native session writer is changing or belongs to CLI",
							});
						return Reflect.apply(value, target, args);
					};
				return value.bind(target);
			},
		});
	}

	async history(identity: NativeIdentity, cursor?: string): Promise<unknown> {
		const entry = this.require(identity);
		if (!entry.daemon)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Native paginated history is currently available for Codex",
			});
		return entry.daemon.client.request("thread/turns/list", {
			threadId: identity.nativeSessionId,
			cursor,
			limit: 100,
			sortDirection: "asc",
			itemsView: "full",
		});
	}

	guardAdapterWrite(
		workspaceId: string,
		profileHash: string,
		method: string,
		nativeSessionId?: string,
	): void {
		if (!nativeSessionId) return;
		const entry = this.entries.get(
			keyOf({ workspaceId, profileHash, nativeSessionId, provider: "codex" }),
		);
		if (!entry) return;
		if (entry.activeWriter !== "control" || this.changing.has(keyOf(entry)))
			throw new TRPCError({
				code: "CONFLICT",
				message: "Native session is owned by CLI",
			});
		if (method === "turn/start") {
			if (entry.turnState !== "idle")
				throw new TRPCError({
					code: "CONFLICT",
					message: "Native session is busy",
				});
			entry.controlIntent = true;
			entry.turnState = "running";
		}
	}

	notification(
		workspaceId: string,
		profileHash: string,
		event: CodexNotification,
	): void {
		const params = event.params as {
			threadId?: string;
			turn?: { id: string };
			requestId?: string | number;
			status?: { type?: string };
			item?: { id?: string };
		};
		if (!params?.threadId) return;
		const entry = this.entries.get(
			keyOf({
				workspaceId,
				profileHash,
				nativeSessionId: params.threadId,
				provider: "codex",
			}),
		);
		if (!entry) return;
		if (
			(event.method === "item/started" || event.method === "item/completed") &&
			params.item?.id
		) {
			entry.approvalItems.set(
				params.item.id,
				codexItemApprovalDetail(params.item),
			);
			if (entry.approvalItems.size > 64) {
				const oldest = entry.approvalItems.keys().next().value;
				if (oldest !== undefined) entry.approvalItems.delete(oldest);
			}
		}
		if (event.method === "turn/started") {
			if (!entry.controlIntent) {
				entry.activeWriter = "cli";
				entry.leaseEpoch = ++this.epoch;
			}
			entry.controlIntent = false;
			entry.turnState = "running";
			entry.turnId = params.turn?.id ?? null;
		} else if (event.method === "turn/completed") {
			entry.approvalItems.clear();
			entry.turnState = "idle";
			entry.turnId = null;
			entry.controlIntent = false;
		} else if (event.method === "serverRequest/resolved") {
			entry.approvals.delete(String(params.requestId));
			entry.pendingApprovals = entry.pendingApprovals.filter(
				(request) => request.requestId !== String(params.requestId),
			);
			if (!entry.pendingApprovals.length)
				entry.turnState = entry.turnId ? "running" : "idle";
		}
	}

	private request(
		workspaceId: string,
		profileHash: string,
		event: CodexServerRequest,
	): void {
		if (
			![
				"item/commandExecution/requestApproval",
				"item/fileChange/requestApproval",
			].includes(event.method)
		)
			return;
		const params = event.params as { threadId?: string; itemId?: string };
		if (!params?.threadId) return;
		const entry = this.entries.get(
			keyOf({
				workspaceId,
				profileHash,
				nativeSessionId: params.threadId,
				provider: "codex",
			}),
		);
		if (!entry) return;
		entry.approvals.set(String(event.id), event);
		entry.pendingApprovals = entry.pendingApprovals.filter(
			(approval) => approval.requestId !== String(event.id),
		);
		entry.pendingApprovals.push({
			requestId: String(event.id),
			method: event.method,
			detail: codexApprovalDetail(
				event.params,
				params.itemId ? entry.approvalItems.get(params.itemId) : undefined,
			),
		});
		entry.turnState = "awaiting-approval";
	}

	private require(identity: NativeIdentity): Entry {
		const entry = this.entries.get(keyOf(identity));
		if (!entry)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Native session is not registered",
			});
		return entry;
	}
	private snapshot(entry: Entry): NativeControlState {
		const {
			daemon: _,
			approvals: __,
			controlIntent: ___,
			approvalItems: ____,
			...state
		} = entry;
		return { ...state, pendingApprovals: [...state.pendingApprovals] };
	}
	private checkEpoch(entry: Entry, epoch: number): void {
		if (entry.leaseEpoch !== epoch)
			throw new TRPCError({
				code: "CONFLICT",
				message: "Native session ownership changed; refresh its state",
			});
	}
	private async exclusive<T>(
		identity: NativeIdentity,
		work: (entry: Entry) => Promise<T>,
	): Promise<T> {
		const key = keyOf(identity);
		if (this.changing.has(key))
			throw new TRPCError({
				code: "CONFLICT",
				message: "Native session ownership is changing",
			});
		this.changing.add(key);
		try {
			return await work(this.require(identity));
		} finally {
			this.changing.delete(key);
		}
	}
}

const brokers = new WeakMap<object, SessionControlBroker>();
export function sessionControlBrokerFor(owner: object): SessionControlBroker {
	let broker = brokers.get(owner);
	if (!broker) {
		broker = new SessionControlBroker();
		brokers.set(owner, broker);
	}
	return broker;
}
