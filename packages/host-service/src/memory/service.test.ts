import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoryFixture } from "./test-fixture";
import { memoryTokens } from "./tokenize";

const scopes = [
	{ scopeKind: "global" as const, scopeId: "" },
	{ scopeKind: "project" as const, scopeId: "p1" },
	{ scopeKind: "team" as const, scopeId: "t1" },
] as const;
describe("Memory persisted service", () => {
	test("isolates scope, deterministic Chinese/English FTS and injection tiers", async () => {
		const f = memoryFixture();
		try {
			for (const scope of scopes)
				f.service.put({
					...scope,
					title: "幂等 mail delivery",
					content: `可信唤醒 ${scope.scopeKind}`,
				});
			expect(memoryTokens("幂等Mail 123")).toEqual([
				"幂",
				"等",
				"幂等",
				"mail",
				"123",
			]);
			for (const scope of scopes) {
				expect(f.service.search({ ...scope, query: "幂等 MAIL" })).toHaveLength(
					1,
				);
				expect(f.service.list(scope)).toHaveLength(1);
			}
			f.service.put({
				...scopes[1],
				title: "archival",
				content: "不注入此文本",
				tier: "archival",
			});
			expect(f.service.search({ query: "唤醒" })).toHaveLength(3);
			expect(f.service.search({ query: '" OR *()' })).toEqual([]);
			expect(
				f.service.injection({ projectId: "p1", teamId: "t1" }).text,
			).not.toContain("不注入此文本");
		} finally {
			await f.dispose();
		}
	});
	test("supersede retains history and FTS only returns active current rows", async () => {
		const f = memoryFixture();
		try {
			const prior = f.service.put({
				...scopes[1],
				title: "Rule",
				content: "oldword",
			});
			const next = f.service.put({
				...scopes[1],
				title: "Rule",
				content: "newword",
				supersedeId: prior.id,
			});
			expect(f.service.get(prior.id).supersededById).toBe(next.id);
			expect(f.service.search({ query: "oldword" })).toEqual([]);
			expect(
				f.service.put({ ...scopes[1], title: "duplicate", content: "newword" })
					.id,
			).toBe(next.id);
			expect(() =>
				f.service.put({
					...scopes[0],
					title: "bad",
					content: "crossscope",
					supersedeId: next.id,
				}),
			).toThrow();
			f.service.remove(next.id);
			expect(f.service.search({ query: "newword" })).toEqual([]);
			expect(
				f.service.list({ ...scopes[1], includeHistory: true }),
			).toHaveLength(2);
		} finally {
			await f.dispose();
		}
	});
	test("global remains candidate until explicit review and cannot auto supersede", async () => {
		const f = memoryFixture();
		try {
			const prior = f.service.put({
				...scopes[0],
				title: "Rule",
				content: "original",
			});
			const candidate = f.service.propose(
				{
					...scopes[0],
					title: "Rule",
					content: "updated",
					tier: "core",
					category: "convention",
					sourceRef: "terminal",
				},
				true,
			);
			expect(candidate.status).toBe("candidate");
			expect(f.service.get(prior.id).supersededById).toBeNull();
			expect(f.service.injection({}).text).not.toContain("updated");
			f.service.reviewCandidate({
				id: candidate.id,
				action: "accept",
				supersedeId: prior.id,
			});
			expect(f.service.get(prior.id).supersededById).toBe(candidate.id);
			expect(() =>
				f.service.reviewCandidate({ id: candidate.id, action: "accept" }),
			).toThrow();
			const reject = f.service.propose({
				...scopes[0],
				title: "Reject",
				content: "discard",
				tier: "core",
				category: "context",
				sourceRef: "terminal",
			});
			expect(
				f.service.reviewCandidate({ id: reject.id, action: "reject" }).status,
			).toBe("rejected");
		} finally {
			await f.dispose();
		}
	});
	test("trusted project semantic slot auto activates, preserves old row, unrelated slot remains", async () => {
		const f = memoryFixture();
		try {
			const base = {
				...scopes[1],
				title: "Use Bun",
				tier: "core" as const,
				category: "convention" as const,
				sourceRef: "terminal",
			};
			const a = f.service.propose(
				{ ...base, content: "Use bun install" },
				true,
			);
			const b = f.service.propose({ ...base, content: "Use bun ci" }, true);
			expect(b.status).toBe("active");
			expect(f.service.get(a.id).supersededById).toBe(b.id);
			const unrelated = f.service.propose(
				{ ...base, title: "Different", content: "Use another rule" },
				true,
			);
			expect(f.service.get(b.id).supersededById).toBeNull();
			expect(unrelated.status).toBe("active");
		} finally {
			await f.dispose();
		}
	});
	test("hard budgets and archived Team cannot leak into another Team", async () => {
		const f = memoryFixture();
		try {
			for (const scope of scopes)
				for (let i = 0; i < 8; i++)
					f.service.put({
						...scope,
						title: `entry ${i}`,
						content: `${scope.scopeKind}-${i}-${"文".repeat(800)}`,
					});
			const result = f.service.injection({ projectId: "p1", teamId: "t1" });
			expect(result.text.length).toBeLessThanOrEqual(4800);
			expect(result.truncated).toBe(true);
			expect(result.text).toContain("jedv memory search");
			f.archived.add("t1");
			expect(
				f.service.injection({ projectId: "p1", teamId: "t1" }).text,
			).not.toContain("team-");
			expect(f.service.injection({ teamId: "t2" }).text).not.toContain("team-");
			expect(() =>
				f.service.put({ ...scopes[2], title: "sealed", content: "sealed" }),
			).toThrow();
		} finally {
			await f.dispose();
		}
	});
	test("JSON roundtrip is atomic, content deduplicated and metadata preserved", async () => {
		const f = memoryFixture();
		try {
			f.service.put({
				...scopes[1],
				title: "Rule",
				content: "幂等",
				sourceRef: "terminal-1",
			});
			const out = f.service.exportProject({ projectId: "p1" });
			expect(out.filePath).toBe(join(f.root, ".jedv/memory.json"));
			const data = JSON.parse(readFileSync(out.filePath, "utf8"));
			expect(data.entries[0].sourceRef).toBe("terminal-1");
			f.service.importProject({
				projectId: "p1",
				filePath: ".jedv/memory.json",
			});
			expect(f.service.list(scopes[1])).toHaveLength(1);
			const before = f.service.list(scopes[1]);
			expect(() =>
				f.service.importData(scopes[1], {
					version: 1,
					entries: [...data.entries, { content: "invalid" }],
				}),
			).toThrow();
			expect(f.service.list(scopes[1])).toEqual(before);
		} finally {
			await f.dispose();
		}
	});
	test("rejects traversal and symlink file/directory escape", async () => {
		const f = memoryFixture();
		try {
			expect(() =>
				f.service.exportProject({
					projectId: "p1",
					filePath: "../escape.json",
				}),
			).toThrow();
			symlinkSync("/tmp", join(f.root, "link"));
			expect(() =>
				f.service.exportProject({
					projectId: "p1",
					filePath: "link/escape.json",
				}),
			).toThrow();
			mkdirSync(join(f.root, ".jedv"));
			writeFileSync(join(f.root, "source.json"), "{}");
			symlinkSync(
				join(f.root, "source.json"),
				join(f.root, ".jedv/memory.json"),
			);
			expect(() =>
				f.service.importProject({
					projectId: "p1",
					filePath: ".jedv/memory.json",
				}),
			).toThrow();
		} finally {
			await f.dispose();
		}
	});
});
