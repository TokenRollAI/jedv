import {
	type LayoutNode,
	type Pane,
	removePaneFromLayout,
	type Tab,
	type WorkspaceState,
} from "@jedv/panes";
import { HTML_PREVIEW_SCHEME } from "@jedv/shared/html-preview";
import { z } from "zod";

export const WORKSPACE_LAYOUT_BYTES = 512 * 1024;
export const WORKSPACE_LAYOUT_CONTEXTS = 8;
const id = z.string().min(1).max(256);
const title = z.string().max(256).optional();
export type PersistedPaneData =
	| { terminalId: string }
	| { url: string }
	| { view: "changes" | "files" };
export interface JedvWorkspaceLayout extends WorkspaceState<PersistedPaneData> {
	detachedTerminalIds: string[];
	rightArea?: WorkspaceState<PersistedPaneData>;
	rightAreaOpen?: boolean;
	activityDockHidden?: boolean;
}
export interface WorkspaceLayoutContext {
	hostId: string;
	workspaceId: string;
	layout: JedvWorkspaceLayout;
}
export type WorkspaceLayoutsByWindow = Record<string, WorkspaceLayoutContext[]>;

export function jsonBytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function persistedUrl(value: string): string {
	if (value === "about:blank" || value.startsWith(`${HTML_PREVIEW_SCHEME}:`))
		return "about:blank";
	try {
		const url = new URL(value);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password
		)
			return "about:blank";
		for (const key of url.searchParams.keys())
			if (/^(psk|token|secret|auth|authorization|password)$/i.test(key))
				return "about:blank";
		return url.href;
	} catch {
		return "about:blank";
	}
}
const dataSchema = z.union([
	z.object({ terminalId: id }).strict(),
	z.object({ url: z.string().max(8192).transform(persistedUrl) }).strict(),
	z.object({ view: z.enum(["changes", "files"]) }).strict(),
]);
const paneSchema = z
	.object({
		id,
		kind: z.enum(["terminal", "browser", "changes", "files"]),
		titleOverride: title,
		pinned: z.boolean().optional(),
		data: dataSchema,
	})
	.strict();
function parseNode(raw: unknown, leaves: Set<string>, depth = 0): LayoutNode {
	if (!raw || typeof raw !== "object" || depth > 7)
		throw new Error("Invalid workspace split layout");
	const value = raw as Record<string, unknown>;
	if (value.type === "pane") {
		const paneId = id.parse(value.paneId);
		if (leaves.has(paneId) || leaves.size >= 8)
			throw new Error("Workspace pane limit or duplicate pane");
		leaves.add(paneId);
		return { type: "pane", paneId };
	}
	if (value.type !== "split") throw new Error("Invalid workspace layout node");
	return {
		type: "split",
		direction: z.enum(["horizontal", "vertical"]).parse(value.direction),
		first: parseNode(value.first, leaves, depth + 1),
		second: parseNode(value.second, leaves, depth + 1),
		...(value.splitPercentage === undefined
			? {}
			: {
					splitPercentage: z
						.number()
						.gt(0)
						.lt(100)
						.parse(value.splitPercentage),
				}),
	};
}
const baseEnvelope = z
	.object({
		version: z.literal(1),
		tabs: z
			.array(
				z
					.object({
						id,
						titleOverride: title,
						createdAt: z.number().finite().nonnegative(),
						activePaneId: id.nullable(),
						layout: z.unknown(),
						panes: z.record(z.string(), paneSchema),
					})
					.strict(),
			)
			.max(32),
		activeTabId: id.nullable(),
		detachedTerminalIds: z.array(id).max(256),
	})
	.strict();
const envelope = baseEnvelope.extend({
	rightArea: baseEnvelope.omit({ detachedTerminalIds: true }).optional(),
	rightAreaOpen: z.boolean().optional(),
	activityDockHidden: z.boolean().optional(),
});
export function decodeWorkspaceLayout(raw: unknown): JedvWorkspaceLayout {
	if (jsonBytes(raw) > WORKSPACE_LAYOUT_BYTES)
		throw new Error("Workspace layout exceeds 512 KiB");
	const value = envelope.parse(raw);
	const tabIds = new Set<string>();
	const paneIds = new Set<string>();
	const terminalIds = new Set<string>();
	const tabs: Tab<PersistedPaneData>[] = value.tabs.map((tab) => {
		if (tabIds.has(tab.id)) throw new Error("Duplicate workspace tab");
		tabIds.add(tab.id);
		const leaves = new Set<string>();
		const layout = parseNode(tab.layout, leaves);
		if (Object.keys(tab.panes).length !== leaves.size)
			throw new Error("Workspace panes do not match split layout");
		for (const [key, pane] of Object.entries(tab.panes)) {
			if (key !== pane.id || !leaves.has(key) || paneIds.has(key))
				throw new Error("Invalid workspace pane reference");
			paneIds.add(key);
			if (pane.kind === "terminal" && "terminalId" in pane.data) {
				if (terminalIds.has(pane.data.terminalId))
					throw new Error("Duplicate terminal identity");
				terminalIds.add(pane.data.terminalId);
			} else if (
				!(pane.kind === "browser" && "url" in pane.data) &&
				!(
					(pane.kind === "changes" || pane.kind === "files") &&
					"view" in pane.data &&
					pane.data.view === pane.kind
				)
			)
				throw new Error("Workspace pane kind does not match data");
		}
		if (tab.activePaneId !== null && !leaves.has(tab.activePaneId))
			throw new Error("Invalid active workspace pane");
		const panes = Object.fromEntries(
			Object.entries(tab.panes).map(([key, pane]) => {
				if (pane.kind !== "browser") return [key, pane];
				const { titleOverride: _title, ...safePane } = pane;
				return [key, safePane];
			}),
		);
		if (Object.values(panes).some((pane) => pane.kind === "browser")) {
			const { titleOverride: _title, ...safeTab } = tab;
			return { ...safeTab, layout, panes };
		}
		return { ...tab, layout, panes };
	});
	if (value.activeTabId !== null && !tabIds.has(value.activeTabId))
		throw new Error("Invalid active workspace tab");
	const right = value.rightArea
		? decodeWorkspaceLayout({ ...value.rightArea, detachedTerminalIds: [] })
		: null;
	if (right) {
		if (tabs.length + right.tabs.length > 32)
			throw new Error("Workspace tab limit exceeded across pane areas");
		for (const tab of right.tabs) {
			if (tabIds.has(tab.id))
				throw new Error("Duplicate workspace tab across pane areas");
			tabIds.add(tab.id);
			for (const pane of Object.values(tab.panes)) {
				if (paneIds.has(pane.id))
					throw new Error("Duplicate workspace pane across pane areas");
				paneIds.add(pane.id);
				if ("terminalId" in pane.data) {
					if (terminalIds.has(pane.data.terminalId))
						throw new Error("Duplicate terminal identity across pane areas");
					terminalIds.add(pane.data.terminalId);
				}
			}
		}
	}

	if (
		[...tabs, ...(right?.tabs ?? [])]
			.flatMap((tab) => Object.values(tab.panes))
			.filter((pane) => pane.kind === "browser").length > 64
	)
		throw new Error("Workspace browser pane limit exceeded across pane areas");
	const detachedTerminalIds = [...new Set(value.detachedTerminalIds)];
	if (detachedTerminalIds.some((key) => terminalIds.has(key)))
		throw new Error("Attached terminal cannot be detached");
	const keptTabs = tabs.flatMap((tab) => {
		let layout: LayoutNode | null = tab.layout;
		const panes = { ...tab.panes };
		for (const pane of Object.values(panes)) {
			if (pane.kind !== "browser") continue;
			if (layout) layout = removePaneFromLayout(layout, pane.id);
			delete panes[pane.id];
		}
		if (!layout) return [];
		return [
			{
				...tab,
				layout,
				panes,
				activePaneId:
					tab.activePaneId && panes[tab.activePaneId]
						? tab.activePaneId
						: (Object.keys(panes)[0] ?? null),
			},
		];
	});
	return {
		version: 1,
		tabs: keptTabs,
		activeTabId: keptTabs.some((tab) => tab.id === value.activeTabId)
			? value.activeTabId
			: (keptTabs[0]?.id ?? null),
		detachedTerminalIds,
		...(right
			? {
					rightArea: {
						version: 1 as const,
						tabs: right.tabs,
						activeTabId: right.activeTabId,
					},
				}
			: {}),
		...(value.rightAreaOpen === undefined
			? {}
			: { rightAreaOpen: value.rightAreaOpen }),
		...(value.activityDockHidden === undefined
			? {}
			: { activityDockHidden: value.activityDockHidden }),
	};
}
export function encodeWorkspaceLayout(
	state: WorkspaceState<PersistedPaneData>,
	detachedTerminalIds: Iterable<string>,
): JedvWorkspaceLayout {
	return decodeWorkspaceLayout({
		version: 1,
		tabs: state.tabs.map((tab) => {
			const hasBrowser = Object.values(tab.panes).some(
				(pane) => pane.kind === "browser",
			);
			return {
				id: tab.id,
				...(!hasBrowser && tab.titleOverride !== undefined
					? { titleOverride: tab.titleOverride }
					: {}),
				createdAt: tab.createdAt,
				activePaneId: tab.activePaneId,
				layout: tab.layout,
				panes: Object.fromEntries(
					Object.values(tab.panes).map(
						(pane): [string, Pane<PersistedPaneData>] => [
							pane.id,
							{
								id: pane.id,
								kind: pane.kind,
								...(pane.kind !== "browser" && pane.titleOverride !== undefined
									? { titleOverride: pane.titleOverride }
									: {}),
								...(pane.pinned === undefined ? {} : { pinned: pane.pinned }),
								data:
									"terminalId" in pane.data
										? { terminalId: pane.data.terminalId }
										: "url" in pane.data
											? { url: persistedUrl(pane.data.url) }
											: {
													view:
														"view" in pane.data && pane.data.view === "files"
															? "files"
															: "changes",
												},
							},
						],
					),
				),
			};
		}),
		activeTabId: state.activeTabId,
		detachedTerminalIds: [...detachedTerminalIds],
	});
}
export const workspaceLayoutSchema = z.unknown().transform((value, ctx) => {
	try {
		return decodeWorkspaceLayout(value);
	} catch (error) {
		ctx.addIssue({
			code: "custom",
			message: error instanceof Error ? error.message : String(error),
		});
		return z.NEVER;
	}
});
export function parseWorkspaceLayouts(raw: unknown): WorkspaceLayoutsByWindow {
	try {
		if (
			!raw ||
			typeof raw !== "object" ||
			Array.isArray(raw) ||
			jsonBytes(raw) > WORKSPACE_LAYOUT_BYTES
		)
			return {};
		const result: WorkspaceLayoutsByWindow = {};
		for (const [key, contexts] of Object.entries(raw).slice(0, 20)) {
			if (
				!key ||
				key.length > 128 ||
				!Array.isArray(contexts) ||
				contexts.length > WORKSPACE_LAYOUT_CONTEXTS
			)
				continue;
			result[key] = contexts.map((context) => ({
				hostId: z.string().min(1).max(2048).parse(context.hostId),
				workspaceId: id.parse(context.workspaceId),
				layout: decodeWorkspaceLayout(context.layout),
			}));
		}
		return result;
	} catch {
		return {};
	}
}
