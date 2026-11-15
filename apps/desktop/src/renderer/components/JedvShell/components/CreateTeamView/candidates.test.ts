import { expect, test } from "bun:test";
import type { TeamSnapshot } from "../../hooks/useTeamwork";
import type { TerminalSession, Workspace } from "../../types";
import { eligibleTeamLeaders, type LeaderBinding } from "./candidates";

test("leader candidates exclude dead, ended, chat, unidentified, archived and already bound sessions", () => {
	const binding = {
		terminalId: "valid",
		workspaceId: "workspace",
		launchId: "launch",
		agentSessionId: "session",
		startedAt: 1,
	} as LeaderBinding;
	const ids = [
		"valid",
		"ended",
		"chat",
		"unknown",
		"dead",
		"occupied",
		"archived",
	];
	const bindings = [
		binding,
		{ ...binding, terminalId: "ended", endedAt: 2 },
		{ ...binding, terminalId: "chat", chatSessionId: "chat-session" },
		{ ...binding, terminalId: "unknown", launchId: undefined },
		{ ...binding, terminalId: "dead" },
		{ ...binding, terminalId: "occupied" },
		{ ...binding, terminalId: "archived", workspaceId: "archived-workspace" },
	];
	const sessions = new Map([
		[
			"workspace",
			ids
				.filter((id) => id !== "dead")
				.map((terminalId) => ({
					terminalId,
					exited: false,
				})) as TerminalSession[],
		],
		[
			"archived-workspace",
			[{ terminalId: "archived", exited: false }] as TerminalSession[],
		],
	]);
	const teams = [
		{
			team: { status: "paused" },
			members: [{ status: "active", terminalId: "occupied" }],
		},
	] as TeamSnapshot[];
	const workspaces = [
		{ id: "workspace", archivedAt: null },
		{ id: "archived-workspace", archivedAt: 1 },
	] as Workspace[];
	expect(
		eligibleTeamLeaders(bindings, sessions, teams, workspaces).map(
			(candidate) => candidate.binding.terminalId,
		),
	).toEqual(["valid"]);
});
