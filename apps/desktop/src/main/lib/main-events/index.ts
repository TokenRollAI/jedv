import { TRPCError } from "@trpc/server";
import type { BrowserWindow } from "electron";
import { LOCAL_HOST_NAMESPACE } from "shared/jedv";
import type {
	MainLocalEvent,
	MainNavigationTarget,
	MainWindowVisibility,
} from "shared/main-events";
import { mainNavigationTargetSchema } from "shared/main-events";
import { getHostServiceCoordinator } from "../host-service-coordinator";
import { hasHostConnection } from "../port-forward";
import { normalizePrivateEndpoint } from "../port-forward/private-endpoint";
import {
	getAllWindows,
	getFocusedOrLastWindow,
	getKey,
	watchWindows,
} from "../window-registry/window-registry";
import {
	isTerminalVisible,
	MainEventQueue,
	parseLocalDeepLink,
	resolveOpenPath,
} from "./core";
import { requireMainWindow } from "./window-access";

export { requireMainWindow } from "./window-access";

export const mainEventQueue = new MainEventQueue();
const visibility = new Map<number, MainWindowVisibility>();
const deferredLocal: Array<{
	source: MainLocalEvent["source"];
	target: NonNullable<ReturnType<typeof parseLocalDeepLink>>;
}> = [];
let initialized = false;
export function localHostOrigin(): string | null {
	const connection =
		getHostServiceCoordinator().getConnection(LOCAL_HOST_NAMESPACE);
	return connection ? `http://127.0.0.1:${connection.port}` : null;
}
export function connectedOrigin(value: string): string {
	let origin: string;
	try {
		origin = normalizePrivateEndpoint(value);
	} catch {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Invalid host origin",
		});
	}
	if (origin !== localHostOrigin() && !hasHostConnection(origin))
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Connect to this host before navigating",
		});
	return origin;
}
export function publishVisibility(
	window: BrowserWindow | null,
	state: MainWindowVisibility,
): void {
	const owner = requireMainWindow(window);
	const hostUrl = state.hostUrl ? connectedOrigin(state.hostUrl) : null;
	if (!visibility.has(owner.id) && visibility.size >= 20)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Window limit reached",
		});
	visibility.set(owner.id, {
		...state,
		hostUrl,
		visibleTerminalIds: hostUrl ? [...new Set(state.visibleTerminalIds)] : [],
	});
}
export function windowHostOrigin(window: BrowserWindow | null): string | null {
	const owner = requireMainWindow(window);
	const origin = visibility.get(owner.id)?.hostUrl;
	return origin ? connectedOrigin(origin) : null;
}
export function sourceIsVisible(target: {
	hostUrl?: string;
	workspaceId?: string;
	terminalId?: string;
}): boolean {
	return getAllWindows().some((window) =>
		isTerminalVisible(visibility.get(window.id), window.isFocused(), target),
	);
}
function focus(window: BrowserWindow): void {
	if (window.isMinimized()) window.restore();
	window.show();
	window.focus();
}
export function enqueueMainNavigation(
	source: MainLocalEvent["source"],
	target: MainNavigationTarget,
	preferred?: BrowserWindow,
): boolean {
	const parsed = mainNavigationTargetSchema.safeParse(target);
	if (!parsed.success) return false;
	target = parsed.data;
	if ("hostUrl" in target) {
		try {
			target = { ...target, hostUrl: connectedOrigin(target.hostUrl) };
		} catch {
			return false;
		}
	}
	const hostTarget = "hostUrl" in target ? target : null;
	const matching = hostTarget
		? getAllWindows().find((window) => {
				const state = visibility.get(window.id);
				return (
					state?.hostUrl === hostTarget.hostUrl &&
					(hostTarget.kind !== "workspace" ||
						state.workspaceId === hostTarget.workspaceId)
				);
			})
		: undefined;
	const window = preferred ?? matching ?? getFocusedOrLastWindow();
	const accepted = mainEventQueue.enqueue(
		source,
		target,
		window ? (getKey(window.id) ?? undefined) : undefined,
	);
	if (!accepted) console.warn("[main-events] Queue limit reached");
	if (accepted && window) focus(window);
	return accepted;
}
function flushLocal(): void {
	const origin = localHostOrigin();
	if (!origin) return;
	for (const item of deferredLocal.splice(0)) {
		const target = item.target;
		if (
			(target.kind === "workspace" || target.kind === "project") &&
			target.hostUrl === null
		)
			enqueueMainNavigation(item.source, { ...target, hostUrl: origin });
	}
}
export function acceptDeepLink(value: string): boolean {
	const target = parseLocalDeepLink(value);
	if (!target) return false;
	if (
		(target.kind === "workspace" || target.kind === "project") &&
		target.hostUrl === null
	) {
		if (deferredLocal.length >= 32) return false;
		deferredLocal.push({ source: "deep-link", target });
		flushLocal();
		return true;
	}
	return enqueueMainNavigation("deep-link", target as MainNavigationTarget);
}
export async function acceptOpenPath(value: string): Promise<boolean> {
	const target = await resolveOpenPath(value);
	return target ? enqueueMainNavigation("open-file", target) : false;
}
export function initializeMainEvents(): void {
	if (initialized) return;
	initialized = true;
	watchWindows((window) => {
		const id = window.id,
			key = getKey(id);
		window.webContents.on("did-start-loading", () => visibility.delete(id));
		window.once("closed", () => {
			visibility.delete(id);
			if (key) mainEventQueue.close(key);
		});
	});
	getHostServiceCoordinator().on("status-changed", () => {
		const current = localHostOrigin();
		for (const [id, state] of visibility) {
			if (
				state.hostUrl &&
				new URL(state.hostUrl).hostname === "127.0.0.1" &&
				state.hostUrl !== current
			)
				visibility.delete(id);
		}
		flushLocal();
	});
	flushLocal();
}
