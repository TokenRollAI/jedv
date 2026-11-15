import { EventEmitter } from "node:events";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { type BrowserWindow, type Rectangle, screen } from "electron";
import { appState } from "main/lib/app-state";
import { setBadgeCount } from "main/lib/dock-icon";
import { connectedOrigin, sourceIsVisible } from "main/lib/main-events";
import { getEntry } from "main/lib/window-registry/window-registry";
import { env } from "shared/env.shared";
import {
	AGENT_ISLAND_EVENTS,
	type AgentIslandApprovalInput,
	type AgentIslandFocusEvent,
	type AgentIslandPreferences,
	type AgentIslandState,
	agentIslandPreferencesSchema,
	DEFAULT_AGENT_ISLAND_PREFERENCES,
} from "shared/types/agent-island";
import { DockAttention } from "./dock-attention";
import {
	AgentIslandProjection,
	islandActivityCounts,
	islandPopoverBounds,
} from "./state";
import { createAgentIslandWindow } from "./window";

export class AgentIslandManager extends EventEmitter {
	constructor(
		private readonly createWindow = createAgentIslandWindow,
		private readonly display = screen,
		private readonly dockOptions: {
			attention?: DockAttention;
			connectedHost?: (hostId: string) => string;
		} = {},
	) {
		super();
		this.attention =
			dockOptions.attention ??
			new DockAttention({
				write: (state) => setBadgeCount(state.count, state.dot),
				visible: (hostId, entry) =>
					sourceIsVisible({
						hostUrl: hostId,
						workspaceId: entry.workspaceId,
						terminalId: entry.terminalId ?? undefined,
					}),
				connected: (hostId) => {
					try {
						return connectedOrigin(hostId) === hostId;
					} catch {
						return false;
					}
				},
			});
	}
	private readonly attention: DockAttention;
	private attentionWindows = new Map<number, () => void>();
	private projection = new AgentIslandProjection();
	private preferences = { ...DEFAULT_AGENT_ISLAND_PREFERENCES };
	private window: BrowserWindow | null = null;
	private publisher: BrowserWindow | null = null;
	private ready = false;
	private initialized = false;
	private stopped = false;
	private write = Promise.resolve();
	private anchor: Rectangle | null = null;

	initialize(): void {
		if (this.initialized) return;
		this.initialized = true;
		const parsed = agentIslandPreferencesSchema.safeParse({
			enabled: appState.data.agentIsland?.enabled,
		});
		this.preferences = parsed.success
			? parsed.data
			: { ...DEFAULT_AGENT_ISLAND_PREFERENCES };
		this.display.on("display-metrics-changed", this.hide);
		this.display.on("display-removed", this.hide);
	}

	activity() {
		return {
			enabled: this.preferences.enabled,
			available:
				this.preferences.enabled &&
				this.projection.binding !== null &&
				this.publisher !== null &&
				!this.publisher.isDestroyed(),
			...islandActivityCounts(this.projection.entries),
		};
	}

	state(): AgentIslandState {
		return {
			preferences: { ...this.preferences },
			binding: this.projection.binding,
			entries: this.projection.entries,
			revision: this.projection.revision,
			visible: this.window?.isVisible() ?? false,
			attentionBadge: this.attention.state(),
		};
	}

	assertMain(window: BrowserWindow | null): BrowserWindow {
		if (
			!window ||
			window.isDestroyed() ||
			getEntry(window.id)?.window !== window
		)
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "A registered main window is required",
			});
		return window;
	}

	assertIsland(window: BrowserWindow | null): BrowserWindow {
		if (!window || window !== this.window || window.isDestroyed())
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "The Island window is required",
			});
		return window;
	}

	assertReader(window: BrowserWindow | null): void {
		if (window !== this.window || !window) this.assertMain(window);
		else this.assertIsland(window);
	}

	async configure(
		patch: Partial<AgentIslandPreferences>,
	): Promise<AgentIslandState> {
		this.initialize();
		this.preferences = agentIslandPreferencesSchema.parse({
			...this.preferences,
			...patch,
		});
		if (!this.preferences.enabled) this.hide();
		const preferences = { ...this.preferences };
		this.write = this.write
			.catch(() => {})
			.then(async () => {
				appState.data.agentIsland = preferences;
				await appState.write();
			});
		await this.write;
		this.sync();
		return this.state();
	}

	bind(window: BrowserWindow, hostId: string): AgentIslandState {
		this.initialize();
		this.assertMain(window);
		hostId = (this.dockOptions.connectedHost ?? connectedOrigin)(hostId);
		if (
			this.projection.binding?.windowId !== window.id ||
			this.projection.binding?.hostId !== hostId
		)
			this.hide();
		if (this.publisher !== window) {
			this.detachPublisher();
			this.publisher = window;
			window.once("closed", this.publisherGone);
			window.webContents.on("did-start-navigation", this.publisherNavigated);
			window.webContents.on("render-process-gone", this.publisherGone);
		}
		this.projection.bind(window.id, hostId);
		this.sync();
		return this.state();
	}

	publish(
		window: BrowserWindow,
		input: { hostId: string; entries: AgentIslandState["entries"] },
	): AgentIslandState {
		this.assertMain(window);
		if (!this.attentionWindows.has(window.id))
			this.watchAttentionWindow(window);
		if (input.entries.length) {
			const hostId = (this.dockOptions.connectedHost ?? connectedOrigin)(
				input.hostId,
			);
			this.attention.publish(window.id, hostId, input.entries);
		} else this.attention.clear(window.id, input.hostId);
		if (
			this.projection.binding?.windowId === window.id &&
			this.projection.binding.hostId === input.hostId
		) {
			this.projection.publish(window.id, input.hostId, input.entries);
			this.sync();
		}
		return {
			...this.state(),
			attentionReadThrough: this.attention.readThrough(window.id),
			attentionReadEntryIds: this.attention.readEntries(window.id),
		};
	}

	toggleFromTray(bounds: Rectangle): boolean {
		if (this.stopped || !this.activity().available) return false;
		if (this.anchor || this.window?.isVisible()) {
			this.hide();
			return true;
		}
		this.anchor = { ...bounds };
		this.ensureWindow();
		if (this.ready) this.showRequestedPopup();
		return true;
	}

	hide = (): void => {
		this.anchor = null;
		this.window?.hide();
		this.sync();
	};

	focus(entryId: string, hostId: string): void {
		const entry = this.projection.entry(entryId);
		const publisher = this.requirePublisher();
		this.projection.assertPublisher(publisher.id, hostId);
		const binding = this.projection.binding;
		if (!binding) throw new TRPCError({ code: "PRECONDITION_FAILED" });
		this.hide();
		if (publisher.isMinimized()) publisher.restore();
		publisher.show();
		publisher.focus();
		const event: AgentIslandFocusEvent = {
			entryId: entry.entryId,
			hostId: binding.hostId,
			workspaceId: entry.workspaceId,
			terminalId: entry.terminalId,
			nativeSessionId: entry.nativeSessionId,
			provider: entry.provider,
		};
		publisher.webContents.send(AGENT_ISLAND_EVENTS.focusTerminal, event);
	}

	approve(input: AgentIslandApprovalInput): { actionId: string } {
		const publisher = this.requirePublisher();
		const event = this.projection.approve(input);
		publisher.webContents.send(AGENT_ISLAND_EVENTS.approval, event);
		return { actionId: event.actionId };
	}

	complete(
		window: BrowserWindow,
		input: { actionId: string; ok: boolean },
	): void {
		this.projection.complete(window.id, input.actionId);
		this.window?.webContents.send(AGENT_ISLAND_EVENTS.approvalResult, input);
	}

	dispose(): void {
		this.stopped = true;
		for (const cleanup of this.attentionWindows.values()) cleanup();
		this.attentionWindows.clear();
		this.attention.dispose();
		this.detachPublisher();
		this.projection.clear();
		this.display.removeListener("display-metrics-changed", this.hide);
		this.display.removeListener("display-removed", this.hide);
		this.anchor = null;
		this.window?.destroy();
		this.window = null;
	}

	private watchAttentionWindow(window: BrowserWindow): void {
		if (this.attentionWindows.size >= 20)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Attention window limit reached",
			});
		const windowId = window.id,
			contents = window.webContents;
		const refresh = () => this.attention.reconcile();
		const clear = () => this.attention.clear(windowId);

		const cleanup = () => {
			window.removeListener("focus", refresh);
			window.removeListener("closed", closed);
			contents.removeListener("did-start-loading", clear);
			contents.removeListener("render-process-gone", clear);
		};
		const closed = () => {
			clear();
			cleanup();
			this.attentionWindows.delete(windowId);
		};
		window.on("focus", refresh);
		window.once("closed", closed);
		contents.on("did-start-loading", clear);
		contents.on("render-process-gone", clear);
		this.attentionWindows.set(windowId, cleanup);
	}

	private requirePublisher(): BrowserWindow {
		if (
			!this.publisher ||
			this.publisher.isDestroyed() ||
			!this.projection.binding
		)
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: "Main window is unavailable",
			});
		return this.publisher;
	}

	private detachPublisher(): void {
		const window = this.publisher;
		this.publisher = null;
		if (!window) return;
		window.removeListener("closed", this.publisherGone);
		if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
			window.webContents.removeListener(
				"did-start-navigation",
				this.publisherNavigated,
			);
			window.webContents.removeListener(
				"render-process-gone",
				this.publisherGone,
			);
		}
	}

	private publisherNavigated = ({
		isMainFrame,
		isSameDocument,
	}: {
		isMainFrame: boolean;
		isSameDocument: boolean;
	}) => {
		if (isMainFrame && !isSameDocument) this.publisherGone();
	};

	private publisherGone = () => {
		this.detachPublisher();
		this.projection.clear();
		this.sync();
	};

	private sync(): void {
		if (this.stopped) return;
		if (!this.projection.binding && this.window) {
			this.window.destroy();
		}
		if (!this.preferences.enabled || !this.projection.binding) {
			this.anchor = null;
			this.window?.hide();
		}
		if (this.ready && this.window && !this.window.isDestroyed())
			this.window.webContents.send(AGENT_ISLAND_EVENTS.state, this.state());
		this.emit("changed");
	}

	private ensureWindow(): void {
		if (!this.window || this.window.isDestroyed()) {
			this.ready = false;
			this.window = this.createWindow({
				onDismiss: this.hide,
				preloadFile: join(__dirname, "../preload/index.js"),
				htmlFile: join(__dirname, "../renderer/index.html"),
				...(env.NODE_ENV === "development"
					? { developmentUrl: `http://localhost:${env.DESKTOP_VITE_PORT}/` }
					: {}),
			});
			this.window.webContents.on("did-start-loading", () => {
				this.ready = false;
			});
			this.window.webContents.on("did-finish-load", () => {
				this.ready = true;
				this.showRequestedPopup();
			});
			this.window.once("closed", () => {
				this.window = null;
				this.ready = false;
				this.anchor = null;
				this.sync();
			});
		}
	}

	private showRequestedPopup(): void {
		if (
			!this.anchor ||
			!this.ready ||
			!this.window ||
			!this.activity().available
		)
			return;
		const display = this.display.getDisplayNearestPoint({
			x: Math.round(this.anchor.x + this.anchor.width / 2),
			y: this.anchor.y,
		});
		this.window.setBounds(islandPopoverBounds(display.workArea, this.anchor));
		this.window.show();
		this.window.focus();
		this.sync();
	}
}

export const agentIslandManager = new AgentIslandManager();
