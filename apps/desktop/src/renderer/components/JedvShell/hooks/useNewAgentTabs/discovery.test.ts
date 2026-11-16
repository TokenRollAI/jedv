import { expect, test } from "bun:test";
import type { ActiveBinding } from "../../components/ActiveWorkspaceSwitcher/active-workspaces";
import type { TerminalSession } from "../../types";
import { createAgentTabDiscovery } from "./discovery";

const session = (id: string, workspaceId = "w") =>
	({ terminalId: id, workspaceId, exited: false }) as TerminalSession;
const binding = (id: string, workspaceId = "w") =>
	({
		terminalId: id,
		workspaceId,
		agentId: "codex",
		startedAt: 0,
		lastEventAt: 0,
		lastEventType: "Start",
		endedAt: undefined,
	}) as ActiveBinding;

test("waits for both authoritative lists and never opens the initial background snapshot", () => {
	const discover = createAgentTabDiscovery("w");
	expect(
		discover({ ready: false, sessions: [session("old")], bindings: [] }),
	).toEqual([]);
	expect(
		discover({
			ready: true,
			sessions: [session("old")],
			bindings: [binding("old")],
		}),
	).toEqual([]);
	expect(
		discover({
			ready: true,
			sessions: [session("old")],
			bindings: [binding("old")],
		}),
	).toEqual([]);
});
test("new sessions and bindings can arrive in either order without opening shells", () => {
	for (const bindingsFirst of [false, true]) {
		const discover = createAgentTabDiscovery("w");
		discover({ ready: true, sessions: [], bindings: [] });
		expect(
			discover({
				ready: true,
				sessions: bindingsFirst ? [] : [session("new"), session("shell")],
				bindings: bindingsFirst ? [binding("new")] : [],
			}),
		).toEqual([]);
		expect(
			discover({
				ready: true,
				sessions: [session("new"), session("shell")],
				bindings: [binding("new")],
			}).map((row) => row.terminalId),
		).toEqual(["new"]);
		expect(
			discover({
				ready: true,
				sessions: [session("new")],
				bindings: [binding("new")],
			}),
		).toEqual([]);
	}
});
test("does not reopen known removed sessions, cross workspace bindings or ended agents", () => {
	const discover = createAgentTabDiscovery("w");
	discover({ ready: true, sessions: [session("old")], bindings: [] });
	discover({ ready: true, sessions: [], bindings: [] });
	expect(
		discover({
			ready: true,
			sessions: [session("old"), session("else", "other"), session("ended")],
			bindings: [
				binding("old"),
				binding("else", "other"),
				{ ...binding("ended"), endedAt: 1 },
			],
		}),
	).toEqual([]);
});
test("a new workspace activation baselines existing agents and discovery has a hard identity bound", () => {
	const discover = createAgentTabDiscovery("w");
	discover({ ready: true, sessions: [], bindings: [] });
	const sessions = Array.from({ length: 513 }, (_, i) => session(`s${i}`));
	expect(
		discover({
			ready: true,
			sessions,
			bindings: sessions.map((row) => binding(row.terminalId)),
		}),
	).toEqual([]);
	expect(
		discover({
			ready: true,
			sessions: [session("later")],
			bindings: [binding("later")],
		}),
	).toEqual([]);
	expect(
		createAgentTabDiscovery("w")({
			ready: true,
			sessions: [session("existing")],
			bindings: [binding("existing")],
		}),
	).toEqual([]);
});

const nativeBinding = (id: string, nativeId = "native-1"): ActiveBinding => ({
	...binding(id),
	agentSessionId: nativeId,
	definitionId: "custom:config-1",
});

test("a detached native session stays background across disappearance and strict successor arrival", () => {
	for (const bindingsFirst of [false, true]) {
		const discover = createAgentTabDiscovery("w");
		discover({
			ready: true,
			sessions: [session("old")],
			bindings: [nativeBinding("old")],
		});
		discover({ ready: true, sessions: [], bindings: [] });
		expect(
			discover({
				ready: true,
				sessions: bindingsFirst ? [] : [session("successor")],
				bindings: bindingsFirst ? [nativeBinding("successor")] : [],
			}),
		).toEqual([]);
		expect(
			discover({
				ready: true,
				sessions: [session("successor")],
				bindings: [nativeBinding("successor")],
			}),
		).toEqual([]);
		const fresh = nativeBinding("fresh", "native-2");
		expect(
			discover({
				ready: true,
				sessions: [session("successor"), session("fresh")],
				bindings: [nativeBinding("successor"), fresh],
			}).map((row) => row.terminalId),
		).toEqual(["fresh"]);
	}
});

test("late native identity on a known terminal takes precedence over a successor in the same snapshot", () => {
	const discover = createAgentTabDiscovery("w");
	discover({
		ready: true,
		sessions: [session("old")],
		bindings: [binding("old")],
	});
	expect(
		discover({
			ready: true,
			sessions: [session("successor")],
			bindings: [
				nativeBinding("successor"),
				{ ...nativeBinding("old"), endedAt: 1 },
			],
		}),
	).toEqual([]);
});

test("native identity includes provider and configured agent and preserves binding-first new discovery", () => {
	const discover = createAgentTabDiscovery("w");
	discover({
		ready: true,
		sessions: [session("old")],
		bindings: [nativeBinding("old")],
	});
	const differentProvider: ActiveBinding = {
		...nativeBinding("provider"),
		agentId: "claude",
	};
	const differentConfig: ActiveBinding = {
		...nativeBinding("config"),
		definitionId: "custom:config-2",
	};
	const bindings = [differentProvider, differentConfig];
	expect(discover({ ready: true, sessions: [], bindings })).toEqual([]);
	expect(
		discover({
			ready: true,
			sessions: [session("provider"), session("config")],
			bindings,
		}).map((row) => row.terminalId),
	).toEqual(["provider", "config"]);
});

test("native identity history also has a hard bound and never evicts old identities into new tabs", () => {
	const discover = createAgentTabDiscovery("w");
	discover({
		ready: true,
		sessions: [session("old")],
		bindings: [nativeBinding("old", "n0")],
	});
	for (let i = 1; i <= 512; i++)
		discover({
			ready: true,
			sessions: [session("old")],
			bindings: [nativeBinding("old", `n${i}`)],
		});
	expect(
		discover({
			ready: true,
			sessions: [session("new")],
			bindings: [nativeBinding("new", "fresh")],
		}),
	).toEqual([]);
});
