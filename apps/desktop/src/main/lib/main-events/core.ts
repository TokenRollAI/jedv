import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type {
	MainLocalEvent,
	MainNavigationTarget,
	MainWindowVisibility,
} from "shared/main-events";
import { mainEventIdSchema, mainSettingsSections } from "shared/main-events";

type DeferredTarget =
	| MainNavigationTarget
	| {
			kind: "workspace";
			hostUrl: null;
			workspaceId: string;
			terminalId?: string;
	  }
	| { kind: "project"; hostUrl: null; projectId: string };
export function parseLocalDeepLink(value: string): DeferredTarget | null {
	if (
		value.length > 4096 ||
		!value.startsWith("jedv://") ||
		value.includes("\\")
	)
		return null;
	const route = value.slice("jedv://".length).split(/[?#]/)[0];
	if (
		route.includes("%") ||
		route.includes("//") ||
		route.split("/").some((segment) => segment === "." || segment === "..")
	)
		return null;
	try {
		const url = new URL(value);
		if (
			url.protocol !== "jedv:" ||
			url.username ||
			url.password ||
			url.port ||
			url.hash
		)
			return null;
		const parts = [url.hostname, ...url.pathname.split("/").filter(Boolean)];
		const [kind, id] = parts;
		if (parts.length > 2 || /%|\\/.test(url.pathname)) return null;
		const keys = [...url.searchParams.keys()];
		if (new Set(keys).size !== keys.length) return null;
		if (kind === "workspace" || kind === "project") {
			if (
				!mainEventIdSchema.safeParse(id).success ||
				keys.some(
					(k) =>
						k !== "hostUrl" && (kind !== "workspace" || k !== "terminalId"),
				)
			)
				return null;
			const hostUrl = url.searchParams.get("hostUrl");
			if (hostUrl !== null && (hostUrl.length > 2048 || !isOrigin(hostUrl)))
				return null;
			if (kind === "project") return { kind, projectId: id, hostUrl };
			const terminalId = url.searchParams.get("terminalId");
			if (
				terminalId !== null &&
				!mainEventIdSchema.safeParse(terminalId).success
			)
				return null;
			return {
				kind,
				workspaceId: id,
				hostUrl,
				...(terminalId ? { terminalId } : {}),
			};
		}
		if (keys.length) return null;
		if (
			kind === "settings" &&
			(!id || mainSettingsSections.some((s) => s === id))
		)
			return {
				kind,
				...(id ? { section: id as (typeof mainSettingsSections)[number] } : {}),
			};
		if ((kind === "automations" || kind === "pull-requests") && !id)
			return { kind };
		return null;
	} catch {
		return null;
	}
}
function isOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			["http:", "https:"].includes(url.protocol) &&
			!url.username &&
			!url.password &&
			url.pathname === "/" &&
			!url.search &&
			!url.hash
		);
	} catch {
		return false;
	}
}
export function isTerminalVisible(
	state: MainWindowVisibility | undefined,
	focused: boolean,
	target: { hostUrl?: string; workspaceId?: string; terminalId?: string },
): boolean {
	return !!(
		focused &&
		state?.hostUrl &&
		target.hostUrl &&
		state.hostUrl === target.hostUrl &&
		target.workspaceId &&
		state.workspaceId === target.workspaceId &&
		target.terminalId &&
		state.visibleTerminalIds.includes(target.terminalId)
	);
}

export class MainEventQueue {
	private pending: MainLocalEvent[] = [];
	private windows = new Map<string, MainLocalEvent[]>();
	private listeners = new Map<string, Set<(event: MainLocalEvent) => void>>();
	constructor(private readonly limit = 32) {}
	enqueue(
		source: MainLocalEvent["source"],
		target: MainNavigationTarget,
		windowKey?: string,
	): boolean {
		if (windowKey && !this.windows.has(windowKey)) {
			if (this.windows.size >= 20) return false;
			this.windows.set(windowKey, []);
		}
		const queue = windowKey ? this.windows.get(windowKey) : this.pending;
		if (!queue) return false;
		if (queue.length >= this.limit) return false;
		const event = { id: randomUUID(), source, target };
		queue.push(event);
		if (windowKey)
			for (const listener of this.listeners.get(windowKey) ?? [])
				listener(event);
		return true;
	}
	subscribe(
		key: string,
		listener: (event: MainLocalEvent) => void,
	): () => void {
		if (!this.windows.has(key)) {
			if (this.windows.size >= 20)
				throw new Error("Main event window limit reached");
			this.windows.set(key, []);
		}
		const queue = this.windows.get(key);
		if (!queue) throw new Error("Missing window queue");
		queue.push(
			...this.pending.splice(0, Math.max(0, this.limit - queue.length)),
		);
		const listeners = this.listeners.get(key) ?? new Set();
		if (listeners.size >= 2)
			throw new Error("Main event subscription limit reached");
		listeners.add(listener);
		this.listeners.set(key, listeners);
		for (const event of [...queue]) listener(event);
		return () => {
			listeners.delete(listener);
			if (!listeners.size) this.listeners.delete(key);
		};
	}
	ack(key: string, id: string): boolean {
		const queue = this.windows.get(key);
		const index = queue?.findIndex((event) => event.id === id) ?? -1;
		if (index < 0 || !queue) return false;
		queue.splice(index, 1);
		const next = this.pending.shift();
		if (next) {
			queue.push(next);
			for (const listener of this.listeners.get(key) ?? []) listener(next);
		}
		return true;
	}
	close(key: string): void {
		this.windows.delete(key);
		this.listeners.delete(key);
	}
}

export function openPathArguments(
	argv: string[],
	defaultApp: boolean,
): string[] {
	const args = argv.slice(defaultApp ? 2 : 1);
	const separator = args.indexOf("--");
	const positional =
		separator >= 0
			? args.slice(separator + 1)
			: args.some((arg) => arg.startsWith("-"))
				? []
				: args;
	return positional
		.filter(
			(arg) => arg.length <= 4096 && !arg.includes("\0") && isAbsolute(arg),
		)
		.slice(0, 32);
}

export async function resolveOpenPath(
	value: string,
): Promise<Extract<MainNavigationTarget, { kind: "open-path" }> | null> {
	if (value.length > 4096 || value.includes("\0") || !isAbsolute(value))
		return null;
	try {
		const info = await stat(value);
		if (!info.isFile() && !info.isDirectory()) return null;
		return {
			kind: "open-path",
			path: value,
			pathType: info.isDirectory() ? "directory" : "file",
			host: "local",
		};
	} catch {
		return null;
	}
}
