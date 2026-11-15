import { expect, test } from "bun:test";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DeepseekClient } from "../ai/deepseek";
import { PassiveMemoryExtractor } from "./extraction";
import { memoryFixture } from "./test-fixture";

function ai(entries: unknown[], counter: { calls: number }) {
	return new DeepseekClient({
		readKey: () => "test-only-secret",
		fetch: async () => {
			counter.calls++;
			return new Response(
				JSON.stringify({
					choices: [
						{
							finish_reason: "stop",
							message: { content: JSON.stringify({ entries }) },
						},
					],
				}),
			);
		},
	});
}
test("trusted transcript produces sourced project active and global candidate; project updates retain history", async () => {
	const f = memoryFixture();
	try {
		const file = join(f.root, "session.jsonl");
		writeFileSync(
			file,
			JSON.stringify({
				role: "user",
				content: "Please use Bun for all package scripts",
			}) + "\n",
		);
		const counter = { calls: 0 };
		const base = {
			title: "Package runner",
			content: "Use Bun for package scripts",
			tier: "core",
			category: "convention",
			evidence: "Please use Bun for all package scripts",
		};
		const extractor = new PassiveMemoryExtractor(
			f.service,
			ai(
				[
					{ ...base, scopeKind: "project" },
					{ ...base, scopeKind: "global" },
				],
				counter,
			),
			() => f.root,
		);
		const entries = await extractor.extract({
			transcriptPath: file,
			terminalId: "terminal-1",
			projectId: "p1",
			trigger: "human_correction",
		});
		expect(entries).toHaveLength(2);
		expect(entries[0]?.status).toBe("active");
		expect(entries[1]?.status).toBe("candidate");
		expect(
			entries.every(
				(x) => x.sourceRef === "terminal-1" && x.sourceKind === "watchdog",
			),
		).toBe(true);
		expect(counter.calls).toBe(1);
		const next = new PassiveMemoryExtractor(
			f.service,
			ai(
				[{ ...base, scopeKind: "project", content: "Always use bun run" }],
				counter,
			),
			() => f.root,
		);
		const result = await next.extract({
			transcriptPath: file,
			terminalId: "terminal-1",
			projectId: "p1",
			trigger: "session_end",
		});
		expect(f.service.get(entries[0]!.id).supersededById).toBe(result[0]!.id);
	} finally {
		await f.dispose();
	}
});
test("unsafe, symlink escape and malformed transcript are discarded before request", async () => {
	const f = memoryFixture();
	try {
		const counter = { calls: 0 };
		const extractor = new PassiveMemoryExtractor(
			f.service,
			ai([], counter),
			() => f.root,
		);
		const invalid = join(f.root, "invalid.jsonl");
		writeFileSync(invalid, "malformed");
		symlinkSync("/etc/passwd", join(f.root, "escape.jsonl"));
		for (const file of [
			"relative.jsonl",
			"/tmp/not-trusted.jsonl",
			invalid,
			join(f.root, "escape.jsonl"),
		])
			expect(
				await extractor.extract({
					transcriptPath: file,
					terminalId: "t",
					trigger: "session_end",
				}),
			).toEqual([]);
		expect(counter.calls).toBe(0);
	} finally {
		await f.dispose();
	}
});
test("missing exact evidence, credential values and missing scope do not become memory", async () => {
	const f = memoryFixture();
	try {
		const file = join(f.root, "session.jsonl");
		writeFileSync(
			file,
			JSON.stringify({ content: "durable trusted evidence" }),
		);
		const base = {
			title: "Rule",
			tier: "core",
			category: "convention",
			evidence: "durable trusted evidence",
			scopeKind: "project",
		};
		const extractor = new PassiveMemoryExtractor(
			f.service,
			ai(
				[
					{ ...base, content: "password=secret123456" },
					{ ...base, content: "fact", evidence: "invented evidence" },
					{ ...base, content: "team context", scopeKind: "team" },
				],
				{ calls: 0 },
			),
			() => f.root,
		);
		expect(
			await extractor.extract({
				transcriptPath: file,
				terminalId: "t",
				projectId: "p",
				trigger: "session_end",
			}),
		).toEqual([]);
	} finally {
		await f.dispose();
	}
});
test("no key skips passive extraction while active memory remains usable", async () => {
	const f = memoryFixture();
	try {
		const file = join(f.root, "session.jsonl");
		writeFileSync(file, '{"content":"some trusted correction"}');
		const extractor = new PassiveMemoryExtractor(
			f.service,
			new DeepseekClient({ readKey: () => null }),
			() => f.root,
		);
		expect(
			await extractor.extract({
				transcriptPath: file,
				terminalId: "t",
				projectId: "p",
				trigger: "session_end",
			}),
		).toEqual([]);
		f.service.put({
			scopeKind: "global",
			title: "active",
			content: "still works",
		});
		expect(f.service.search({ query: "works" })).toHaveLength(1);
	} finally {
		await f.dispose();
	}
});

for (const alreadyActive of [false, true]) {
	test(`late extraction remains a candidate after a newer correction${alreadyActive ? " reaffirms existing memory" : " becomes active"}`, async () => {
		const f = memoryFixture();
		const oldResponse = Promise.withResolvers<Response>();
		let calls = 0;
		const older = "Always use npm for package scripts";
		const newer = "Always use Bun for package scripts";
		const response = (content: string) =>
			new Response(
				JSON.stringify({
					choices: [
						{
							finish_reason: "stop",
							message: {
								content: JSON.stringify({
									entries: [
										{
											scopeKind: "project",
											title: "Package runner",
											content,
											evidence: content,
											tier: "core",
											category: "correction",
										},
									],
								}),
							},
						},
					],
				}),
			);
		const client = new DeepseekClient({
			readKey: () => "isolated-extraction-test",
			fetch: async () =>
				++calls === 1 ? oldResponse.promise : response(newer),
		});
		const extractor = new PassiveMemoryExtractor(
			f.service,
			client,
			() => f.root,
		);
		let pending: Promise<unknown> | undefined;
		try {
			const existing = alreadyActive
				? f.service.put({
						scopeKind: "project",
						scopeId: "p1",
						title: "Package runner",
						content: newer,
						category: "correction",
					})
				: undefined;
			const file = join(f.root, "ordered.jsonl");
			const input = {
				transcriptPath: file,
				terminalId: "same-terminal",
				projectId: "p1",
				trigger: "human_correction" as const,
			};
			writeFileSync(file, JSON.stringify({ role: "user", content: older }));
			const oldJob = extractor.extract(input);
			pending = oldJob;
			expect(calls).toBe(1);
			writeFileSync(file, JSON.stringify({ role: "user", content: newer }));
			const fresh = await extractor.extract(input);
			expect(fresh[0]?.status).toBe("active");
			if (existing) expect(fresh[0]?.id).toBe(existing.id);
			oldResponse.resolve(response(older));
			const stale = await oldJob;
			expect(stale[0]?.status).toBe("candidate");
			expect(f.service.get(fresh[0]!.id).supersededById).toBeNull();
			expect(
				f.service.list({ scopeKind: "project", scopeId: "p1" }),
			).toMatchObject([{ id: fresh[0]!.id, content: newer }]);
			expect(f.service.injection({ projectId: "p1" }).text).toContain(newer);
			expect(f.service.injection({ projectId: "p1" }).text).not.toContain(
				older,
			);
		} finally {
			oldResponse.resolve(response(older));
			await pending;
			client.dispose();
			await f.dispose();
		}
	});
}
