import { expect, test } from "bun:test";
import {
	approvalDetail,
	chatApprovalDetail,
	codexApprovalDetail,
	codexItemApprovalDetail,
} from "./approval-detail";

test("approval details expose bounded action fields and redact credentials", () => {
	const result = approvalDetail({
		command:
			'TOKEN="private-value" curl -H "Authorization: Bearer secret-value" https://user:password@example.com/test',
		cwd: "/workspace",
		paths: Array.from({ length: 22 }, (_, index) => `/src/${index}.ts`),
		reason: "a".repeat(1200),
		env: { PASSWORD: "must-not-appear" },
	});
	expect(result.command).toContain("curl");
	expect(result.command).not.toContain("private-value");
	expect(result.command).not.toContain("secret-value");
	expect(result.command).not.toContain("user:password");
	expect(result.paths).toHaveLength(20);
	expect(result.reason?.length).toBe(1025);
	expect(result.redacted).toBe(true);
	expect(result.truncated).toBe(true);
	expect(result).not.toHaveProperty("env");
	const tokenUrl = approvalDetail({
		command: "git fetch https://opaque-example-credential@example.test/repo",
	});
	expect(tokenUrl.command).not.toContain("opaque-example-credential");
	expect(tokenUrl.redacted).toBe(true);
});

test("approval projection only inspects its bounded content prefix", () => {
	const overflow = {
		get path(): string {
			throw new Error("unbounded path read");
		},
	};
	const paths = codexItemApprovalDetail({
		type: "fileChange",
		changes: [
			...Array.from({ length: 20 }, (_, index) => ({
				path: `/fixture/${index}`,
			})),
			overflow,
		],
	});
	expect(paths.paths).toHaveLength(20);
	expect(paths.truncated).toBe(true);
	const content = chatApprovalDetail({
		detail: [
			...Array.from({ length: 20 }, () => ({
				type: "terminal",
				command: "x".repeat(10_000),
			})),
			{
				get type(): string {
					throw new Error("unbounded content read");
				},
			},
		],
	});
	expect(content.command?.length).toBe(4097);
	expect(content.truncated).toBe(true);
});

test("file approvals retain paths and requested scope without exposing file contents", () => {
	const cached = codexItemApprovalDetail({
		type: "fileChange",
		changes: [{ path: "/workspace/a.ts", diff: "private file contents" }],
	});
	const result = codexApprovalDetail(
		{ reason: "Apply changes", grantRoot: "/workspace" },
		cached,
	);
	expect(result.paths).toEqual(["/workspace/a.ts"]);
	expect(result.permissions).toEqual(["/workspace"]);
	expect(JSON.stringify(result)).not.toContain("private file contents");
	expect(
		chatApprovalDetail({
			title: "Run tests",
			detail: [
				{ type: "terminal", command: "bun test", output: "private output" },
			],
		}),
	).toMatchObject({ command: "bun test", reason: "Run tests" });
});
