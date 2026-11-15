import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import {
	jedvNavigationSchema,
	type MainLocalEvent,
	mainNavigationTargetSchema,
	mainVisibilitySchema,
} from "shared/main-events";
import {
	__resetForTests,
	registerWindow,
	unregisterWindow,
} from "../window-registry/window-registry";
import {
	isTerminalVisible,
	MainEventQueue,
	openPathArguments,
	parseLocalDeepLink,
	resolveOpenPath,
} from "./core";
import { mainWindowKey, requireMainWindow } from "./window-access";

afterEach(() => __resetForTests());
test("deep links accept typed destinations, never credentials, commands or ambiguous parameters", () => {
	expect(parseLocalDeepLink("jedv://workspace/ws-1?terminalId=term-1")).toEqual(
		{
			kind: "workspace",
			workspaceId: "ws-1",
			terminalId: "term-1",
			hostUrl: null,
		},
	);
	expect(
		parseLocalDeepLink(
			"jedv://project/p?hostUrl=https%3A%2F%2Fbox.tail.ts.net",
		),
	).toEqual({
		kind: "project",
		projectId: "p",
		hostUrl: "https://box.tail.ts.net",
	});
	for (const section of [
		"terminal",
		"project",
		"workspace",
		"projects",
		"permissions",
	] as const) {
		const target = { kind: "settings", section } as const;
		expect(parseLocalDeepLink(`jedv://settings/${section}`)).toEqual(target);
		expect(mainNavigationTargetSchema.parse(target)).toEqual(target);
	}
	for (const value of [
		"https://workspace/a",
		"jedv://user:psk@workspace/a",
		"jedv://workspace/a?token=secret",
		"jedv://workspace/a?command=rm",
		"jedv://workspace/a?hostUrl=https%3A%2F%2Fuser%3Asecret%40box.tail.ts.net",
		"jedv://workspace/a?terminalId=x&terminalId=y",
		"jedv://workspace/%2e%2e/a",
		"jedv://settings/unknown",
		"jedv://automations#command",
		"jedv://channels/a",
	])
		expect(parseLocalDeepLink(value)).toBeNull();
});
test("cold-start queue replays until own-window ack and bounds and releases window data", () => {
	const queue = new MainEventQueue(2),
		seen: MainLocalEvent[] = [];
	expect(queue.enqueue("deep-link", { kind: "automations" })).toBe(true);
	const unsubscribe = queue.subscribe("a", (event) => seen.push(event));
	expect(seen).toHaveLength(1);
	expect(queue.ack("b", seen[0].id)).toBe(false);
	unsubscribe();
	const replay: MainLocalEvent[] = [];
	const off = queue.subscribe("a", (event) => replay.push(event));
	expect(replay[0].id).toBe(seen[0].id);
	expect(queue.enqueue("notification", { kind: "settings" }, "a")).toBe(true);
	expect(queue.enqueue("notification", { kind: "settings" }, "a")).toBe(false);
	expect(queue.ack("a", seen[0].id)).toBe(true);
	expect(queue.ack("a", seen[0].id)).toBe(false);
	off();
	queue.close("a");
	const afterClose: MainLocalEvent[] = [];
	queue.subscribe("a", (event) => afterClose.push(event))();
	expect(afterClose).toHaveLength(0);
});
test("visibility requires focus and matching host, workspace and visible terminal", () => {
	const state = {
		hostUrl: "https://one.tail.ts.net",
		workspaceId: "w",
		visibleTerminalIds: ["t"],
	};
	const target = { hostUrl: state.hostUrl, workspaceId: "w", terminalId: "t" };
	expect(isTerminalVisible(state, true, target)).toBe(true);
	expect(isTerminalVisible(state, false, target)).toBe(false);
	expect(
		isTerminalVisible(state, true, {
			...target,
			hostUrl: "https://two.tail.ts.net",
		}),
	).toBe(false);
	expect(
		isTerminalVisible(state, true, { ...target, workspaceId: "other" }),
	).toBe(false);
	expect(
		isTerminalVisible(state, true, { ...target, terminalId: "hidden" }),
	).toBe(false);
	expect(
		isTerminalVisible(state, true, { workspaceId: "w", terminalId: "t" }),
	).toBe(false);
});
test("window access requires registered BrowserWindow identity and returns stable key", () => {
	const window = { id: 42, isDestroyed: () => false } as BrowserWindow;
	registerWindow({ window, orgId: null, key: "persisted-window-key" });
	expect(mainWindowKey(window)).toBe("persisted-window-key");
	expect(() => requireMainWindow(null)).toThrow(
		"Registered main window required",
	);
	expect(() =>
		requireMainWindow({ id: 42, isDestroyed: () => false } as BrowserWindow),
	).toThrow("Registered main window required");
	unregisterWindow(window.id);
	expect(() => mainWindowKey(window)).toThrow(
		"Registered main window required",
	);
});
test("navigation and visibility state bound IDs and cannot store credentials or extra fields", () => {
	const state = {
		hostUrl: "http://127.0.0.1:1234",
		workspaceId: "w",
		terminalId: "t",
		sidebarCollapsed: false,
		collapsedProjects: ["p"],
	};
	expect(jedvNavigationSchema.safeParse(state).success).toBe(true);
	expect(
		jedvNavigationSchema.safeParse({ ...state, workspaceSortMode: "active" })
			.success,
	).toBe(true);
	expect(
		jedvNavigationSchema.safeParse({ ...state, workspaceSortMode: "unknown" })
			.success,
	).toBe(false);
	expect(
		jedvNavigationSchema.safeParse({ ...state, token: "secret" }).success,
	).toBe(false);
	expect(
		jedvNavigationSchema.safeParse({
			...state,
			hostUrl: "https://user:secret@box.tail.ts.net",
		}).success,
	).toBe(false);
	expect(
		jedvNavigationSchema.safeParse({
			...state,
			collapsedProjects: Array(65).fill("p"),
		}).success,
	).toBe(false);
	expect(
		mainVisibilitySchema.safeParse({
			hostUrl: state.hostUrl,
			workspaceId: "w",
			visibleTerminalIds: Array(33).fill("t"),
		}).success,
	).toBe(false);
});
test("OS path intake accepts isolated files and directories, never option values or missing relative paths", async () => {
	const directory = await mkdtemp(join(tmpdir(), "jedv-main-events-"));
	try {
		const file = join(directory, "sample.txt");
		await writeFile(file, "isolated fixture");
		expect(await resolveOpenPath(file)).toEqual({
			kind: "open-path",
			path: file,
			pathType: "file",
			host: "local",
		});
		expect((await resolveOpenPath(directory))?.pathType).toBe("directory");
		expect(await resolveOpenPath("relative.txt")).toBeNull();
		expect(await resolveOpenPath(join(directory, "missing"))).toBeNull();
		expect(openPathArguments(["electron", "main.js", file], true)).toEqual([
			file,
		]);
		expect(
			openPathArguments(["jedv", "--user-data-dir", directory], false),
		).toEqual([]);
		expect(openPathArguments(["jedv", "--", file], false)).toEqual([file]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
