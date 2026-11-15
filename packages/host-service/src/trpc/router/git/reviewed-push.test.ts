import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SimpleGit } from "simple-git";
import { createUserSimpleGit } from "../../../runtime/git/simple-git";
import type { HostServiceContext } from "../../../types";
import { gitRouter } from "./git";
import { redactPushUrl } from "./utils/reviewed-push";

let root: string;
let repo: string;
let remote: string;
let git: SimpleGit;
let gitEnv: Record<string, string>;

function caller(
	linkedPrHeadBranch: string | null = null,
	authenticated = true,
) {
	return gitRouter.createCaller({
		isAuthenticated: authenticated,
		db: {
			query: {
				workspaces: {
					findFirst: () => ({
						sync: () => ({
							worktreePath: repo,
							pullRequestId: linkedPrHeadBranch ? "pr" : null,
						}),
					}),
				},
				pullRequests: {
					findFirst: () => ({
						sync: () => ({ headBranch: linkedPrHeadBranch }),
					}),
				},
			},
		},
		credentials: {
			getCredentials: async () => ({ env: gitEnv }),
			getToken: async () => null,
		},
	} as unknown as HostServiceContext);
}

async function preview(linkedPrHeadBranch: string | null = null) {
	const result = await caller(linkedPrHeadBranch).getPushPreview({
		workspaceId: "ws",
	});
	if (result.status !== "ready")
		throw new Error(`Unexpected refusal: ${result.reason}`);
	return result;
}

async function commit(content = "next") {
	writeFileSync(join(repo, "file.txt"), content);
	await git.raw(["add", "file.txt"]);
	await git.raw(["commit", "-m", content]);
}

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "jedv-reviewed-push-"));
	repo = join(root, "repo");
	remote = join(root, "remote.git");
	mkdirSync(repo);
	gitEnv = Object.fromEntries(
		Object.entries(process.env).flatMap(([key, value]) =>
			!key.startsWith("GIT_") && value !== undefined ? [[key, value]] : [],
		),
	);
	Object.assign(gitEnv, {
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
		LC_ALL: "C",
	});
	git = createUserSimpleGit(repo, { env: gitEnv });
	await git.raw(["init", "-b", "main"]);
	await git.raw(["config", "user.name", "test"]);
	await git.raw(["config", "user.email", "test@example.com"]);
	await git.raw(["config", "commit.gpgsign", "false"]);
	await git.raw(["config", "core.hooksPath", "/dev/null"]);
	await git.raw(["init", "--bare", remote]);
	await git.raw(["remote", "add", "origin", remote]);
	await commit("initial");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("preview is read-only and reviewed publish only sends the confirmed branch", async () => {
	const config = readFileSync(join(repo, ".git/config"), "utf8");
	await git.raw(["branch", "other"]);
	await git.raw(["tag", "-a", "hidden-tag", "-m", "tag"]);
	const result = await preview();
	expect(result).toMatchObject({
		mode: "publish",
		sourceBranch: "main",
		targetBranch: "main",
		remote: "origin",
		remoteUrl: remote,
		setUpstream: true,
	});
	expect(readFileSync(join(repo, ".git/config"), "utf8")).toBe(config);
	expect(
		await git.raw(["--git-dir", remote, "for-each-ref", "--format=%(refname)"]),
	).toBe("");
	await caller().pushReviewed({
		workspaceId: "ws",
		confirmationToken: result.confirmationToken,
	});
	expect(
		(
			await git.raw(["--git-dir", remote, "rev-parse", "refs/heads/main"])
		).trim(),
	).toBe(result.head);
	expect(
		(
			await git.raw([
				"--git-dir",
				remote,
				"for-each-ref",
				"--format=%(refname)",
			])
		).trim(),
	).toBe("refs/heads/main");
	expect((await git.raw(["config", "branch.main.merge"])).trim()).toBe(
		"refs/heads/main",
	);
	expect(
		(await git.raw(["rev-parse", "--abbrev-ref", "@{upstream}"])).trim(),
	).toBe("origin/main");
	expect(await preview()).toMatchObject({
		mode: "default",
		setUpstream: false,
	});
});

test("ordinary default push to an existing same-name upstream is supported", async () => {
	await git.raw(["push", "-u", "origin", "main"]);
	await commit();
	const result = await preview();
	expect(result).toMatchObject({
		mode: "default",
		setUpstream: false,
		targetBranch: "main",
	});
	await caller().pushReviewed({
		workspaceId: "ws",
		confirmationToken: result.confirmationToken,
	});
	expect(
		(await git.raw(["--git-dir", remote, "rev-parse", "main"])).trim(),
	).toBe(result.head);
});

test("branch.pushRemote takes priority over remote.pushDefault in a triangular push", async () => {
	await git.raw(["push", "-u", "origin", "main"]);
	const fork = join(root, "fork.git");
	await git.raw(["init", "--bare", fork]);
	await git.raw(["remote", "add", "fork", fork]);
	await git.raw(["config", "remote.pushDefault", "origin"]);
	await git.raw(["config", "branch.main.pushRemote", "fork"]);
	await commit();
	const result = await preview();
	expect(result).toMatchObject({
		mode: "default",
		remote: "fork",
		remoteUrl: fork,
	});
	await caller().pushReviewed({
		workspaceId: "ws",
		confirmationToken: result.confirmationToken,
	});
	expect((await git.raw(["--git-dir", fork, "rev-parse", "main"])).trim()).toBe(
		result.head,
	);
	expect(
		(await git.raw(["--git-dir", remote, "rev-parse", "main"])).trim(),
	).not.toBe(result.head);
});

test("linked PR uses the deliberately different upstream head", async () => {
	await git.raw(["push", "origin", "HEAD:refs/heads/pr-head"]);
	await git.raw(["switch", "-c", "alice/pr-head"]);
	await git.raw(["branch", "--set-upstream-to=origin/pr-head"]);
	const result = await preview("pr-head");
	expect(result).toMatchObject({
		mode: "linked-pr",
		sourceBranch: "alice/pr-head",
		targetBranch: "pr-head",
		setUpstream: false,
	});
	await caller("pr-head").pushReviewed({
		workspaceId: "ws",
		confirmationToken: result.confirmationToken,
	});
	expect(
		(
			await git.raw([
				"--git-dir",
				remote,
				"for-each-ref",
				"--format=%(refname)",
			])
		).trim(),
	).toBe("refs/heads/pr-head");
});

test("a remote advance is rejected without force", async () => {
	await git.raw(["push", "-u", "origin", "main"]);
	const result = await preview();
	await git.raw(["switch", "-c", "remote-advance"]);
	await commit("remote advance");
	const remoteHead = (await git.revparse(["HEAD"])).trim();
	await git.raw(["push", "origin", "HEAD:refs/heads/main"]);
	await git.raw(["switch", "main"]);
	await expect(
		caller().pushReviewed({
			workspaceId: "ws",
			confirmationToken: result.confirmationToken,
		}),
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	expect(
		(await git.raw(["--git-dir", remote, "rev-parse", "main"])).trim(),
	).toBe(remoteHead);
});

test("tracking the base branch publishes the workspace branch under its own name", async () => {
	await git.raw(["push", "-u", "origin", "main"]);
	await git.raw(["switch", "-c", "feature"]);
	await git.raw(["branch", "--set-upstream-to=origin/main"]);
	expect(await preview()).toMatchObject({
		mode: "publish",
		sourceBranch: "feature",
		targetBranch: "feature",
		setUpstream: true,
	});
});

test.each([
	"head",
	"url",
	"config",
	"linked-pr",
	"branch",
])("stale %s confirmation fails with CONFLICT before any push", async (change) => {
	const result = await preview();
	if (change === "head") await commit();
	if (change === "url")
		await git.raw(["remote", "set-url", "origin", join(root, "other.git")]);
	if (change === "config") await git.raw(["config", "push.followTags", "true"]);
	if (change === "branch") await git.raw(["switch", "-c", "changed"]);
	const error = await caller(change === "linked-pr" ? "new-pr-head" : null)
		.pushReviewed({
			workspaceId: "ws",
			confirmationToken: result.confirmationToken,
		})
		.then(
			() => null,
			(error: unknown) => error,
		);
	expect(error).toMatchObject({ code: "CONFLICT" });
	expect(
		await git.raw(["--git-dir", remote, "for-each-ref", "--format=%(refname)"]),
	).toBe("");
});

test.each([
	["remote.origin.push", "refs/heads/*:refs/heads/*", "custom-push-refspec"],
	["remote.origin.mirror", "true", "mirror"],
	["push.followTags", "true", "follow-tags"],
	["push.recurseSubmodules", "on-demand", "recurse-submodules"],
	["push.default", "matching", "push-default-matching"],
])("unsupported configuration %s is reported honestly", async (key, value, reason) => {
	await git.raw(["push", "-u", "origin", "main"]);
	await git.raw(["config", key, value]);
	expect(await caller().getPushPreview({ workspaceId: "ws" })).toMatchObject({
		status: "unsupported",
		reason,
	});
});

test("multiple push URLs are unsupported", async () => {
	await git.raw(["config", "--add", "remote.origin.pushurl", remote]);
	await git.raw([
		"config",
		"--add",
		"remote.origin.pushurl",
		join(root, "second.git"),
	]);
	expect(await caller().getPushPreview({ workspaceId: "ws" })).toMatchObject({
		status: "unsupported",
		reason: "multiple-push-urls",
	});
});

test("preview uses Git's final rewritten URL and removes credentials and query", async () => {
	await git.raw(["remote", "set-url", "origin", "review:repo.git"]);
	await git.raw([
		"config",
		"url.https://secret:password@example.test/.pushInsteadOf",
		"review:",
	]);
	const result = await preview();
	expect(result.remoteUrl).toBe("https://example.test/repo.git");
	expect(JSON.stringify(result)).not.toContain("password");
	expect(
		redactPushUrl("https://user:secret@example.test/repo?token=secret#secret"),
	).toBe("https://example.test/repo");
	expect(redactPushUrl("user@host:org/repo.git")).toBe("host:org/repo.git");
});

test("getConflicts reads unmerged index paths including newlines without scanning text markers", async () => {
	const path = "conflict\nfile.txt";
	writeFileSync(join(repo, path), "base\n");
	await git.raw(["add", "--", path]);
	await git.raw(["commit", "-m", "base"]);
	await git.raw(["switch", "-c", "side"]);
	writeFileSync(join(repo, path), "side\n");
	await git.raw(["commit", "-am", "side"]);
	await git.raw(["switch", "main"]);
	writeFileSync(join(repo, path), "main\n");
	await git.raw(["commit", "-am", "main"]);
	await git.raw(["merge", "side"]).catch(() => {});
	writeFileSync(join(repo, path), "binary-ish resolved text\0");
	writeFileSync(
		join(repo, "marker-only.txt"),
		"<<<<<<< literal example\n=======\n>>>>>>> example\n",
	);
	expect(await caller().getConflicts({ workspaceId: "ws" })).toEqual({
		paths: [path],
	});
	expect(await caller().getPushPreview({ workspaceId: "ws" })).toMatchObject({
		status: "unsupported",
		reason: "unresolved-conflicts",
	});
	await git.raw(["add", "--", path]);
	expect(await caller().getConflicts({ workspaceId: "ws" })).toEqual({
		paths: [],
	});
});

test("new endpoints keep authentication", async () => {
	await expect(
		caller(null, false).getPushPreview({ workspaceId: "ws" }),
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	await expect(
		caller(null, false).getConflicts({ workspaceId: "ws" }),
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	await expect(
		caller(null, false).pushReviewed({
			workspaceId: "ws",
			confirmationToken: "a".repeat(64),
		}),
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});
