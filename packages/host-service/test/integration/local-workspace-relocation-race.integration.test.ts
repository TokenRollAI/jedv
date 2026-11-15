import { expect, test } from "bun:test";
import { projects, workspaces } from "../../src/db/schema";
import { createCallerFactory } from "../../src/trpc";
import { workspacesRouter } from "../../src/trpc/router/workspaces/workspaces";
import type { HostServiceContext } from "../../src/types";
import { createGitFixture } from "../helpers/git-fixture";
import { createProjectScenario } from "../helpers/scenarios";

test.each([
	"opening Git",
	"reading the branch",
])("Local create rejects relocation while %s and retries on the new checkout", async (pausedPhase) => {
	const s = await createProjectScenario();
	const moved = await createGitFixture();
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const ctx = {
		db: s.host.db,
		eventBus: s.host.eventBus,
		isAuthenticated: true,
		organizationId: "00000000-0000-0000-0000-000000000001",
		git: async () => {
			if (pausedPhase === "opening Git") {
				entered.resolve();
				await release.promise;
			}
			return {
				raw: async (args: string[]) => {
					const result = await s.repo.git.raw(args);
					if (pausedPhase === "reading the branch") {
						entered.resolve();
						await release.promise;
					}
					return result;
				},
				revparse: (args: string[]) => s.repo.git.revparse(args),
			};
		},
	} as unknown as HostServiceContext;
	try {
		const caller = createCallerFactory(workspacesRouter)(ctx);
		const creating = caller.createLocal({
			projectId: s.projectId,
			name: "concurrent",
		});
		await entered.promise;
		await s.host.trpc.project.setup.mutate({
			projectId: s.projectId,
			mode: { kind: "import", repoPath: moved.repoPath, allowRelocate: true },
		});
		release.resolve();
		await expect(creating).rejects.toMatchObject({ code: "CONFLICT" });
		expect(s.host.db.select().from(workspaces).all()).toHaveLength(0);
		await s.host.trpc.workspaces.createLocal.mutate({
			projectId: s.projectId,
			name: "retried",
		});
		const row = s.host.db.select().from(workspaces).all()[0];
		const project = s.host.db.select().from(projects).all()[0];
		expect(row?.worktreePath).toBe(project?.repoPath);
	} finally {
		release.resolve();
		await s.dispose();
		moved.dispose();
	}
});
