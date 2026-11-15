import { expect, test } from "bun:test";
import type { TerminalSession } from "../../../../types";
import { createTerminalWorkspaceStore } from "../../../JedvTerminalWorkspace/layout";
import { sessionContinuation, terminalSessionRows } from "./session-list";

test("session rows preserve current/newest order, real times and terminal-only pane membership", () => {
	const store = createTerminalWorkspaceStore();
	store.getState().addTab({
		id: "mixed",
		panes: [
			{
				id: "a",
				kind: "terminal",
				data: { terminalId: "a" },
				titleOverride: "Explicit name",
			},
			{ id: "browser", kind: "browser", data: { terminalId: "browser-only" } },
		],
	});
	const sessions = [
		{
			terminalId: "b",
			createdAt: 200,
			title: "Background",
			workspaceId: "w",
			exited: false,
		},
		{
			terminalId: "a",
			createdAt: 100,
			title: "Shell",
			workspaceId: "w",
			customTitle: "Custom",
			exited: false,
		},
		{
			terminalId: "browser-only",
			createdAt: 50,
			title: "Detached",
			workspaceId: "w",
			exited: false,
		},
	] as TerminalSession[];
	const rows = terminalSessionRows(sessions, store, "a");
	expect(
		rows.map((row) => [
			row.session.terminalId,
			row.current,
			row.attached,
			row.title,
			row.session.createdAt,
		]),
	).toEqual([
		["a", true, true, "Explicit name", 100],
		["b", false, false, "Background", 200],
		["browser-only", false, false, "Detached", 50],
	]);
	expect(
		sessionContinuation(sessions[0] as TerminalSession, [], []),
	).toBeNull();
});
