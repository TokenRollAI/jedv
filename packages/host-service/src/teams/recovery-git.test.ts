import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gitTasks, gitWorktreeListTask } from "../workers/tasks/git";

test("Team recovery's registered worker task reads actual Git registration without creating resources", async () => {
	const repoPath = await mkdtemp(join(tmpdir(), "jedv-team-registration-"));
	const gitEnv = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
	try {
		await promisify(execFile)("git", ["init", "-b", "main", repoPath], {
			env: { ...process.env, ...gitEnv },
		});
		expect(gitTasks).toContain(gitWorktreeListTask);
		expect(
			await gitWorktreeListTask.handler({
				repoPath,
				gitEnv,
			}),
		).toContainEqual(
			expect.objectContaining({ path: realpathSync(repoPath), branch: "main" }),
		);
	} finally {
		await rm(repoPath, { recursive: true, force: true });
	}
});
