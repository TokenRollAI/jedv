import { expect, mock, test } from "bun:test";
import type {
	ResumeCandidate,
	SessionBinding,
	SessionPickerContext,
} from "../../types";
import { continueTerminalSession } from "./continue-session";

test("continue verifies exact live terminal/native identity and refuses a changed binding", async () => {
	const expected = {
		terminalId: "original",
		workspaceId: "w",
		agentId: "gemini",
		agentSessionId: "native-1",
		endedAt: undefined,
		definitionId: "config",
	} as unknown as SessionBinding;
	let current = expected;
	const target = {
		workspaceId: "w",
		client: {
			terminal: {
				list: {
					query: async () => ({
						sessions: [
							{ terminalId: "original", workspaceId: "w", exited: false },
						],
					}),
				},
			},
			terminalAgents: { get: { query: async () => current } },
		},
	} as unknown as SessionPickerContext;
	expect(
		await continueTerminalSession(target, { kind: "live", binding: expected }),
	).toMatchObject({
		source: "cli",
		terminalId: "original",
		nativeSessionId: "native-1",
	});
	current = { ...expected, agentSessionId: "different" };
	await expect(
		continueTerminalSession(target, { kind: "live", binding: expected }),
	).rejects.toThrow("identity-changed");
});
test("continue reuses strict successor and verifies native identity without launchNew or legacy resume", async () => {
	const legacy = mock(async () => ({ terminalId: "wrong-new" }));
	const candidate: ResumeCandidate = {
		terminalId: "origin",
		provider: "gemini",
		nativeSessionId: "native-1",
		definitionId: null,
		label: "Gemini",
		resumeSupported: true,
	};
	const resume = mock(async (_input: unknown) => ({
		resumed: true,
		terminalId: "successor",
	}));
	const target = {
		workspaceId: "w",
		client: {
			terminalAgents: {
				resumeCandidates: { query: async () => [candidate] },
				resumedSuccessorStrict: { query: async () => null },
				resumeStrict: { mutate: resume },
				get: {
					query: async () => ({
						terminalId: "successor",
						workspaceId: "w",
						agentId: "gemini",
						agentSessionId: "native-1",
					}),
				},
				resume: { mutate: legacy },
			},
			agents: { launchNew: { mutate: legacy } },
		},
	} as unknown as SessionPickerContext;
	expect(
		await continueTerminalSession(target, { kind: "resume", candidate }),
	).toMatchObject({
		source: "cli",
		terminalId: "successor",
		nativeSessionId: "native-1",
	});
	expect(resume).toHaveBeenCalledWith({
		workspaceId: "w",
		terminalId: "origin",
		expectedNativeSessionId: "native-1",
	});
	expect(legacy).not.toHaveBeenCalled();
	target.client.terminalAgents.resumedSuccessorStrict.query = async () => {
		throw Object.assign(new Error("NOT_FOUND"), {
			data: { code: "NOT_FOUND" },
		});
	};
	await expect(
		continueTerminalSession(target, { kind: "resume", candidate }),
	).rejects.toThrow("strict-unavailable");
	expect(legacy).not.toHaveBeenCalled();
});
