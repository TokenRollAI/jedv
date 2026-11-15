import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { LocalClient } from "./local-client";
import {
	finishTerminalResult,
	type TerminalResultContext,
} from "./terminal-result";

test("Run and Control completion after a context switch refresh only their origin cache without selecting a terminal", async () => {
	for (const changed of ["host", "workspace", "client"] as const) {
		let resolve!: (value: { sessions: { terminalId: string }[] }) => void;
		const response = new Promise<{ sessions: { terminalId: string }[] }>(
			(done) => {
				resolve = done;
			},
		);
		const requested: unknown[] = [];
		const client = {
			terminal: {
				list: {
					query: (input: unknown) => {
						requested.push(input);
						return response;
					},
				},
			},
		} as unknown as LocalClient;
		const expected: TerminalResultContext = {
			client,
			hostUrl: "https://old.ts.net",
			workspaceId: "old-workspace",
		};
		const current: { current: TerminalResultContext | null } = {
			current: expected,
		};
		const cache = new QueryClient();
		const selected: (string | null)[] = [];
		try {
			const completion = finishTerminalResult(
				expected,
				"old-terminal",
				current,
				cache,
				(id) => selected.push(id),
			);
			current.current = {
				...expected,
				...(changed === "host"
					? { hostUrl: "https://new.ts.net" }
					: changed === "workspace"
						? { workspaceId: "new-workspace" }
						: { client: {} as LocalClient }),
			};
			resolve({ sessions: [{ terminalId: "old-terminal" }] });
			await completion;
			expect(requested).toEqual([{ workspaceId: "old-workspace" }]);
			expect(selected).toEqual([]);
			expect(
				cache.getQueryData([
					"jedv",
					expected.hostUrl,
					"terminals",
					expected.workspaceId,
				]),
			).toEqual({ sessions: [{ terminalId: "old-terminal" }] });
			if (changed !== "client")
				expect(
					cache.getQueryData([
						"jedv",
						current.current.hostUrl,
						"terminals",
						current.current.workspaceId,
					]),
				).toBeUndefined();
		} finally {
			cache.clear();
		}
	}
});

test("completion selects only a terminal confirmed in the still-current workspace", async () => {
	const client = {
		terminal: {
			list: { query: async () => ({ sessions: [{ terminalId: "live" }] }) },
		},
	} as unknown as LocalClient;
	const expected = {
		client,
		hostUrl: "http://127.0.0.1:7777",
		workspaceId: "workspace",
	};
	const cache = new QueryClient();
	const selected: (string | null)[] = [];
	try {
		await finishTerminalResult(
			expected,
			"gone",
			{ current: expected },
			cache,
			(id) => selected.push(id),
		);
		await finishTerminalResult(
			expected,
			null,
			{ current: expected },
			cache,
			(id) => selected.push(id),
		);
		await finishTerminalResult(
			expected,
			"live",
			{ current: expected },
			cache,
			(id) => selected.push(id),
		);
		expect(selected).toEqual([null, "live"]);
	} finally {
		cache.clear();
	}
});
