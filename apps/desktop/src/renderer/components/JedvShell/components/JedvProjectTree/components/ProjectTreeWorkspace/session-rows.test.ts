import { expect, test } from "bun:test";
import type { TerminalSession } from "../../../../types";
import type { ActiveBinding } from "../../../ActiveWorkspaceSwitcher/active-workspaces";
import {
	attachTerminalSession,
	createTerminalWorkspaceStore,
	workspacePaneAreas,
} from "../../../JedvTerminalWorkspace/layout";
import { workspaceAgentSessions } from "./session-rows";

const session = (id: string) =>
	({
		terminalId: id,
		workspaceId: "w",
		title: "Codex",
		createdAt: 0,
	}) as TerminalSession;
const binding = (id: string, workspaceId = "w") =>
	({
		terminalId: id,
		workspaceId,
		agentId: "codex",
		endedAt: undefined,
		startedAt: 0,
		lastEventAt: 0,
		lastEventType: "Start",
	}) as ActiveBinding;
test("projects names and real pane locations across both areas, independent of transport attached", () => {
	const store = createTerminalWorkspaceStore();
	const sessions = [
		session("left"),
		session("right"),
		{ ...session("background"), attached: true },
	];
	attachTerminalSession(store, sessions[0]);
	attachTerminalSession(workspacePaneAreas(store).right, sessions[1]);
	store.getState().setPaneTitleOverride({
		tabId: "left",
		paneId: "left",
		titleOverride: "UI repair",
	});
	const rows = workspaceAgentSessions({
		store,
		sessions,
		workspaceId: "w",
		ready: true,
		bindings: [
			binding("left"),
			binding("right"),
			binding("background"),
			binding("other", "else"),
			binding("missing"),
		],
		memberNames: new Map([["other", "reviewer"]]),
	});
	expect(rows.get("left")?.name).toBe("UI repair");
	expect(rows.get("left")?.location).toBe("tab");
	expect(rows.get("right")?.location).toBe("right");
	expect(rows.get("background")?.location).toBe("background");
	expect(rows.get("right")?.name).not.toBe(rows.get("background")?.name);
	expect(rows.get("other")?.name).toBe("reviewer");
	expect(rows.get("other")?.location).toBe("unknown");
	expect(rows.get("missing")?.location).toBe("unknown");
});
