import { expect, test } from "bun:test";
import type { LocalClient } from "../../../../../local-client";
import type { AgentBinding } from "../types";
import { resumeExistingCli } from "./resume-existing";
import { selectionForBinding } from "./selection";

type Candidate = Awaited<
	ReturnType<LocalClient["terminalAgents"]["resumeCandidates"]["query"]>
>[number];
const candidate: Candidate = {
	terminalId: "origin",
	provider: "gemini",
	nativeSessionId: "native-1",
	definitionId: null,
	label: "Fixture",
	resumeSupported: true,
};
function fixture(provider: Candidate["provider"] = "gemini") {
	const calls: { name: string; input: unknown }[] = [];
	const row = { ...candidate, provider };
	let binding = {
		terminalId: "successor",
		workspaceId: "fixture",
		agentId: provider,
		agentSessionId: "native-1",
		definitionId: undefined,
		chatSessionId: undefined,
	} as AgentBinding;
	const agents = {
		resumeCandidates: {
			query: async (input: unknown) => {
				calls.push({ name: "candidates", input });
				return [row];
			},
		},
		resumedSuccessorStrict: {
			query: async (input: unknown) => {
				calls.push({ name: "successor", input });
				return null;
			},
		},
		resumeStrict: {
			mutate: async (input: unknown) => {
				calls.push({ name: "resume", input });
				return { resumed: true, terminalId: "successor", label: "Fixture" };
			},
		},
		get: {
			query: async (input: unknown) => {
				calls.push({ name: "get", input });
				return binding;
			},
		},
		queryNativeSession: {
			query: async (input: unknown) => {
				calls.push({ name: "native", input });
				return {
					supported: true,
					source: "native-session",
					provider,
					nativeSessionId: "native-1",
					leaseEpoch: 7,
				};
			},
		},
		openNativeCli: {
			mutate: async (input: unknown) => {
				calls.push({ name: "open", input });
				return { terminalId: "successor" };
			},
		},
	};
	return {
		calls,
		row,
		agents,
		client: { terminalAgents: agents } as unknown as Pick<
			LocalClient,
			"terminalAgents"
		>,
		setBinding(value: AgentBinding) {
			binding = value;
		},
		binding,
	};
}
test("CLI resume checks current host capability and always supplies strict expected identity", async () => {
	const f = fixture();
	expect(await resumeExistingCli(f.client, "fixture", f.row)).toMatchObject({
		source: "cli",
		terminalId: "successor",
		nativeSessionId: "native-1",
	});
	expect(f.calls.map((c) => c.name)).toEqual([
		"candidates",
		"successor",
		"resume",
		"get",
	]);
	for (const c of f.calls.filter(
		(c) => c.name === "successor" || c.name === "resume",
	))
		expect(c.input).toEqual({
			workspaceId: "fixture",
			terminalId: "origin",
			expectedNativeSessionId: "native-1",
		});
});
test("old host NOT_FOUND cannot fall back to legacy resume", async () => {
	const f = fixture();
	f.agents.resumeCandidates.query = async () => {
		throw new Error("NOT_FOUND");
	};
	await expect(resumeExistingCli(f.client, "fixture", f.row)).rejects.toThrow(
		"NOT_FOUND",
	);
	expect(f.calls).toEqual([]);
});
test("legacy inflight conflict propagates without another launch route", async () => {
	const f = fixture();
	f.agents.resumeStrict.mutate = async () => {
		throw new Error("CONFLICT");
	};
	await expect(resumeExistingCli(f.client, "fixture", f.row)).rejects.toThrow(
		"CONFLICT",
	);
	expect(f.calls.map((c) => c.name)).toEqual(["candidates", "successor"]);
});
test("four native providers reopen the exact identity with its current lease", async () => {
	for (const provider of ["codex", "claude", "agy", "kimi"] as const) {
		const f = fixture(provider);
		await resumeExistingCli(f.client, "fixture", f.row);
		expect(f.calls.map((c) => c.name)).toEqual([
			"candidates",
			"native",
			"open",
			"get",
		]);
		expect(f.calls.find((c) => c.name === "open")?.input).toEqual({
			workspaceId: "fixture",
			provider,
			nativeSessionId: "native-1",
			agentConfigId: undefined,
			expectedLeaseEpoch: 7,
		});
	}
});
test("a changed successor native ID or provider is never selected", async () => {
	const f = fixture();
	for (const changed of [
		{ ...f.binding, agentSessionId: "different" },
		{ ...f.binding, agentId: "codex" as const },
	]) {
		f.setBinding(changed);
		await expect(resumeExistingCli(f.client, "fixture", f.row)).rejects.toThrow(
			"identity-changed",
		);
	}
});
test("chat bindings select their existing chat ID instead of attaching their terminal", () => {
	const f = fixture("codex");
	expect(
		selectionForBinding({ ...f.binding, chatSessionId: "original-chat" }),
	).toMatchObject({
		source: "chat-session",
		terminalId: null,
		chatSessionId: "original-chat",
		bindingTerminalId: "successor",
	});
});

test("a host with candidates but no strict routes never calls legacy fallback", async () => {
	const f = fixture();
	let legacyCalls = 0;
	const missing = Object.assign(new Error("NOT_FOUND"), {
		data: { code: "NOT_FOUND" },
	});
	Object.assign(f.agents, {
		resume: {
			mutate: async () => {
				legacyCalls++;
				return { resumed: true, terminalId: "wrong-new-session" };
			},
		},
		resumedSuccessor: {
			query: async () => {
				legacyCalls++;
				return null;
			},
		},
	});
	f.agents.resumedSuccessorStrict.query = async () => {
		throw missing;
	};
	await expect(resumeExistingCli(f.client, "fixture", f.row)).rejects.toThrow(
		"strict-unavailable",
	);
	expect(legacyCalls).toBe(0);
	expect(f.calls.map((call) => call.name)).toEqual(["candidates"]);
});
