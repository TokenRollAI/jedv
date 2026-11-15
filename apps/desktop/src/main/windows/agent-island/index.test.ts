import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { BrowserWindow, screen } from "electron";
import { appState, initAppState } from "main/lib/app-state";
import {
	registerWindow,
	unregisterWindow,
} from "main/lib/window-registry/window-registry";
import { AgentIslandManager } from ".";
import { DockAttention } from "./dock-attention";

test("snapshots and enabling never open the popup; only a tray click opens it and dismissal stays closed", async () => {
	await initAppState();
	const previous = appState.data.agentIsland;
	appState.data.agentIsland = undefined;
	let visible = false;
	let destroyed = false;
	let creations = 0;
	let shows = 0;
	let dismiss = () => {};
	const webContents = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
		send() {},
	});
	const popup = Object.assign(new EventEmitter(), {
		webContents,
		isVisible: () => visible,
		isDestroyed: () => destroyed,
		hide: () => {
			visible = false;
		},
		show: () => {
			visible = true;
			shows++;
		},
		focus() {},
		setBounds() {},
		destroy: () => {
			destroyed = true;
			visible = false;
			popup.emit("closed");
		},
	}) as unknown as BrowserWindow;
	const publisher = Object.assign(new EventEmitter(), {
		id: 1,
		webContents,
		isDestroyed: () => false,
	}) as unknown as BrowserWindow;
	const display = Object.assign(new EventEmitter(), {
		getDisplayNearestPoint: () => ({
			workArea: { x: 0, y: 38, width: 1440, height: 850 },
		}),
	}) as unknown as typeof screen;
	const manager = new AgentIslandManager(
		(options) => {
			creations++;
			dismiss = options.onDismiss;
			return popup;
		},
		display,
		{
			attention: new DockAttention({ write: () => {}, visible: () => false }),
			connectedHost: (host) => host,
		},
	);
	registerWindow({ window: publisher, orgId: null, key: "island-fixture" });
	try {
		manager.bind(publisher, "host");
		expect(manager.state().preferences.enabled).toBe(false);
		await manager.configure({ enabled: true });
		manager.publish(publisher, {
			hostId: "host",
			entries: [
				{
					entryId: "entry",
					workspaceId: "workspace",
					workspaceName: "Workspace",
					projectName: "Project",
					provider: "codex",
					nativeSessionId: "native",
					profileHash: "profile",
					terminalId: "terminal",
					activeWriter: "control",
					leaseEpoch: 1,
					turnState: "awaiting-approval",
					completedUnread: false,
					pendingApprovals: [{ requestId: "approval", method: "approval" }],
				},
			],
		});
		expect(creations).toBe(0);
		expect(shows).toBe(0);
		expect(manager.activity().approvals).toBe(1);
		expect(
			manager.toggleFromTray({ x: 1000, y: 0, width: 20, height: 38 }),
		).toBe(true);
		expect(creations).toBe(1);
		expect(visible).toBe(false);
		webContents.emit("did-finish-load");
		expect(visible).toBe(true);
		expect(shows).toBe(1);
		dismiss();
		expect(visible).toBe(false);
		manager.publish(publisher, { hostId: "host", entries: [] });
		expect(shows).toBe(1);
		expect(visible).toBe(false);
		manager.toggleFromTray({ x: 1000, y: 0, width: 20, height: 38 });
		expect(visible).toBe(true);
		await manager.configure({ enabled: false });
		expect(visible).toBe(false);
		expect(
			manager.toggleFromTray({ x: 1000, y: 0, width: 20, height: 38 }),
		).toBe(false);
	} finally {
		manager.dispose();
		unregisterWindow(publisher.id);
		appState.data.agentIsland = previous;
		await appState.write();
	}
});

test("Dock accepts registered non-Island publishers while disabled and cleans reload and closed windows", async () => {
	await initAppState();
	const previous = appState.data.agentIsland;
	appState.data.agentIsland = { enabled: false };
	const makeWindow = (id: number) =>
		Object.assign(new EventEmitter(), {
			id,
			isDestroyed: () => false,
			webContents: Object.assign(new EventEmitter(), {
				isDestroyed: () => false,
				send() {},
			}),
		}) as unknown as BrowserWindow;
	const a = makeWindow(201),
		b = makeWindow(202);
	const attention = new DockAttention({
		write: () => {},
		visible: () => false,
	});
	const display = new EventEmitter() as unknown as typeof screen;
	const manager = new AgentIslandManager(
		() => {
			throw new Error("Snapshot must not create a popup");
		},
		display,
		{ attention, connectedHost: (host) => host },
	);
	const entry = {
		entryId: "e",
		workspaceId: "w",
		workspaceName: "W",
		projectName: "P",
		provider: "codex" as const,
		nativeSessionId: "native",
		profileHash: "profile",
		terminalId: "t",
		activeWriter: "control" as const,
		leaseEpoch: 1,
		turnState: "awaiting-approval" as const,
		completedUnread: false,
		pendingApprovals: [{ requestId: "r", method: "approval" }],
	};
	registerWindow({ window: a, orgId: null, key: "attention-a" });
	registerWindow({ window: b, orgId: null, key: "attention-b" });
	try {
		manager.bind(a, "host-a");
		manager.publish(a, { hostId: "host-a", entries: [entry] });
		manager.publish(b, {
			hostId: "host-b",
			entries: [{ ...entry, entryId: "b", nativeSessionId: "second" }],
		});
		expect(manager.state().preferences.enabled).toBe(false);
		expect(manager.state().attentionBadge?.count).toBe(2);
		expect(manager.state().binding?.windowId).toBe(a.id);
		expect(manager.state().entries[0].nativeSessionId).toBe("native");
		b.webContents.emit("did-start-loading");
		expect(manager.state().attentionBadge?.count).toBe(1);
		manager.publish(b, {
			hostId: "host-b",
			entries: [{ ...entry, entryId: "b", nativeSessionId: "second" }],
		});
		b.emit("closed");
		expect(manager.state().attentionBadge?.count).toBe(1);
		a.emit("closed");
		expect(manager.state().attentionBadge?.count).toBe(0);
	} finally {
		manager.dispose();
		unregisterWindow(a.id);
		unregisterWindow(b.id);
		appState.data.agentIsland = previous;
	}
});

test("closing a destroyed publisher clears its binding without reading native webContents", async () => {
	await initAppState();
	let destroyed = false;
	const contents = Object.assign(new EventEmitter(), {
		isDestroyed: () => destroyed,
	});
	const publisher = Object.defineProperty(
		Object.assign(new EventEmitter(), {
			id: 203,
			isDestroyed: () => destroyed,
		}),
		"webContents",
		{
			get() {
				if (destroyed) throw new TypeError("Object has been destroyed");
				return contents;
			},
		},
	) as unknown as BrowserWindow;
	const manager = new AgentIslandManager(
		() => {
			throw new Error("Binding must not create a popup");
		},
		new EventEmitter() as unknown as typeof screen,
		{
			attention: new DockAttention({ write: () => {}, visible: () => false }),
			connectedHost: (host) => host,
		},
	);
	registerWindow({ window: publisher, orgId: null, key: "closed-publisher" });
	try {
		manager.bind(publisher, "host");
		destroyed = true;
		expect(() => publisher.emit("closed")).not.toThrow();
		expect(manager.state().binding).toBeNull();
		expect(manager.activity().available).toBe(false);
		expect(() => manager.dispose()).not.toThrow();
	} finally {
		unregisterWindow(203);
	}
});
