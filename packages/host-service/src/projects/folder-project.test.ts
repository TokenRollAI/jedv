import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { HostDb } from "../db";
import * as schema from "../db/schema";
import { GitWatcher } from "../events/git-watcher";
import type { WorkspaceFilesystemManager } from "../runtime/filesystem";
import { scanGitIgnoredDirectories } from "../runtime/filesystem/watcher-scans";
import { PullRequestRuntimeManager } from "../runtime/pull-requests/pull-requests";
import { createCallerFactory } from "../trpc";
import { gitRouter } from "../trpc/router/git/git";
import { projectRouter } from "../trpc/router/project/project";
import { pullRequestsRouter } from "../trpc/router/pull-requests/pull-requests";
import { workspaceRouter } from "../trpc/router/workspace/workspace";
import { workspaceCleanupRouter } from "../trpc/router/workspace-cleanup/workspace-cleanup";
import { workspaceCreationRouter } from "../trpc/router/workspace-creation/workspace-creation";
import { workspacesRouter } from "../trpc/router/workspaces/workspaces";
import type { HostServiceContext } from "../types";
import { purgeDeletedProject, softDeleteProject } from "./project-deletion";
import { getVcsCapabilities, isPlainDirectory } from "./vcs-capabilities";

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function fixture() {
	const root = mkdtempSync(join(tmpdir(), "jedv-folder-unit-"));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	const folder = join(root, "user-files");
	mkdirSync(folder);
	writeFileSync(join(folder, "keep.txt"), "user content\n");
	const sqlite = new Database(":memory:");
	cleanups.push(() => sqlite.close());
	const db = drizzle(sqlite, { schema }) as unknown as HostDb;
	migrate(db as never, {
		migrationsFolder: resolve(import.meta.dir, "../../drizzle"),
	});
	let gitCalls = 0;
	const snapshots: unknown[] = [];
	const ctx = {
		db,
		isAuthenticated: true,
		organizationId: "jedv-local",
		clientMachineId: "folder-test",
		userId: "human",
		git: async () => {
			gitCalls++;
			throw new Error("Folder must not start Git");
		},
		execGh: async () => {
			throw new Error("Folder must not start gh");
		},
		github: async () => {
			throw new Error("Folder must not call GitHub");
		},
		runtime: {},
		eventBus: new Proxy(
			{},
			{ get: () => (value: unknown) => snapshots.push(value) },
		),
	} as unknown as HostServiceContext;
	const project = createCallerFactory(projectRouter)(ctx);
	const created = await project.create({
		name: "Ordinary folder",
		mode: { kind: "folder", repoPath: folder },
	});
	const workspace = await createCallerFactory(workspacesRouter)(ctx).create({
		projectId: created.projectId,
		checkout: "local",
		name: "Folder work",
		trackSetupCompletion: true,
	});
	return {
		root,
		folder,
		db,
		ctx,
		project,
		created,
		workspaceId: workspace.workspace.id,
		gitCalls: () => gitCalls,
		snapshots,
	};
}

test("folder import is canonical and idempotent without Git; workspace returns capability snapshots", async () => {
	const f = await fixture();
	const alias = join(f.root, "alias");
	symlinkSync(f.folder, alias);
	const again = await f.project.create({
		name: "Do not rename",
		mode: { kind: "folder", repoPath: alias },
	});
	expect(again).toMatchObject({
		projectId: f.created.projectId,
		created: false,
		repoPath: realpathSync(f.folder),
	});
	const capability = {
		vcsKind: "none",
		capabilities: { git: false, pullRequests: false, worktrees: false },
	};
	expect(await f.project.get({ projectId: f.created.projectId })).toMatchObject(
		{ ...capability, name: "Ordinary folder" },
	);
	expect((await f.project.list())[0]).toMatchObject(capability);
	expect(
		await createCallerFactory(workspaceRouter)(f.ctx).get({
			id: f.workspaceId,
		}),
	).toMatchObject(capability);
	expect(
		(await createCallerFactory(workspaceRouter)(f.ctx).list({}))[0],
	).toMatchObject({ ...capability, type: "local", branch: "" });
	expect(f.snapshots).toContainEqual(
		expect.objectContaining({ workspace: expect.objectContaining(capability) }),
	);
	expect(
		(await f.project.findByPath({ repoPath: f.folder })).candidates[0]?.id,
	).toBe(f.created.projectId);
	expect(f.gitCalls()).toBe(0);
	expect(existsSync(join(f.folder, ".git"))).toBe(false);
});

test("folder Git status, PR/branch/worktree operations fail before side effects", async () => {
	const f = await fixture();
	const creation = createCallerFactory(workspaceCreationRouter)(f.ctx);
	await expect(
		createCallerFactory(pullRequestsRouter)(f.ctx).createForWorkspace({
			workspaceId: f.workspaceId,
			title: "No folder PR",
		}),
	).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
	const unavailable = expect.objectContaining({ code: "PRECONDITION_FAILED" });
	await expect(
		createCallerFactory(gitRouter)(f.ctx).getStatus({
			workspaceId: f.workspaceId,
		}),
	).rejects.toMatchObject(unavailable);
	await expect(
		creation.listProjectWorktrees({ projectId: f.created.projectId }),
	).rejects.toMatchObject(unavailable);
	await expect(
		creation.searchBranches({ projectId: f.created.projectId, refresh: true }),
	).rejects.toMatchObject(unavailable);
	await expect(
		createCallerFactory(workspacesRouter)(f.ctx).create({
			projectId: f.created.projectId,
			branch: "new",
		}),
	).rejects.toMatchObject(unavailable);
	expect(f.db.select().from(schema.workspaces).all()).toHaveLength(1);
	expect(f.gitCalls()).toBe(0);
});

test("folder watcher interest and PR startup/explicit sync never enter Git pipelines", async () => {
	const f = await fixture();
	let fsCalls = 0,
		refsReads = 0;
	const filesystem = new Proxy(
		{},
		{
			get: () => () => {
				fsCalls++;
				throw new Error("No Git watcher attach");
			},
		},
	) as WorkspaceFilesystemManager;
	const watcher = new GitWatcher(f.db, filesystem);
	watcher.watchWorkspace(f.workspaceId);
	const internals = watcher as unknown as {
		rescan(): Promise<void>;
		watched: Map<string, unknown>;
	};
	await internals.rescan();
	expect(internals.watched.size).toBe(0);
	expect(fsCalls).toBe(0);
	expect(await scanGitIgnoredDirectories(f.folder)).toEqual([]);
	const manager = new PullRequestRuntimeManager({
		db: f.db,
		git: f.ctx.git,
		execGh: f.ctx.execGh,
		github: f.ctx.github,
		gitWatcher: watcher,
		readWorkspaceRefs: async () => {
			refsReads++;
			throw new Error("No folder refs");
		},
	});
	const runtime = manager as unknown as {
		syncWorkspaceBranches(): Promise<void>;
		refreshEligibleProjects(): Promise<void>;
		syncOneWorkspace(
			id: string,
			options: { bypassCache: boolean },
		): Promise<void>;
	};
	await runtime.syncWorkspaceBranches();
	await runtime.refreshEligibleProjects();
	await runtime.syncOneWorkspace(f.workspaceId, { bypassCache: true });
	expect(refsReads).toBe(0);
	expect(f.gitCalls()).toBe(0);
	manager.stop();
	watcher.close();
});

test("archive, project delete and purge preserve all user-owned folder files, even malformed worktree rows", async () => {
	const f = await fixture();
	const cleanup = createCallerFactory(workspaceCleanupRouter)(f.ctx);
	expect(await cleanup.inspect({ workspaceId: f.workspaceId })).toMatchObject({
		sharesProjectCheckout: true,
		canDelete: true,
	});
	await cleanup.destroy({ workspaceId: f.workspaceId, skipTeardown: false });
	expect(readFileSync(join(f.folder, "keep.txt"), "utf8")).toBe(
		"user content\n",
	);
	const extra = join(f.root, "external-user-folder");
	mkdirSync(extra);
	writeFileSync(join(extra, "keep.txt"), "extra user content");
	f.db
		.insert(schema.workspaces)
		.values({
			id: randomUUID(),
			projectId: f.created.projectId,
			worktreePath: extra,
			branch: "old",
			type: "worktree",
		})
		.run();
	await softDeleteProject(f.ctx, f.created.projectId);
	expect(await purgeDeletedProject(f.ctx, f.created.projectId)).toBe(true);
	expect(readFileSync(join(extra, "keep.txt"), "utf8")).toBe(
		"extra user content",
	);
	expect(readFileSync(join(f.folder, "keep.txt"), "utf8")).toBe(
		"user content\n",
	);
	expect(
		f.db
			.select()
			.from(schema.projects)
			.where(eq(schema.projects.id, f.created.projectId))
			.get(),
	).toBeUndefined();
	expect(f.gitCalls()).toBe(0);
});

test("Git directories and linked-worktree pointer files retain Git capability", () => {
	const root = mkdtempSync(join(tmpdir(), "jedv-capability-"));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	expect(getVcsCapabilities(root).vcsKind).toBe("none");
	expect(isPlainDirectory(root)).toBe(true);
	expect(isPlainDirectory(join(root, "missing-checkout"))).toBe(false);
	mkdirSync(join(root, ".git"));
	expect(isPlainDirectory(root)).toBe(false);
	expect(getVcsCapabilities(root)).toMatchObject({
		vcsKind: "git",
		capabilities: { git: true, pullRequests: true, worktrees: true },
	});
	rmSync(join(root, ".git"), { recursive: true });
	writeFileSync(join(root, ".git"), "gitdir: /some/main/.git/worktrees/test\n");
	expect(getVcsCapabilities(root).vcsKind).toBe("git");
	rmSync(join(root, ".git"));
	symlinkSync(join(root, "missing-git-metadata"), join(root, ".git"));
	expect(isPlainDirectory(root)).toBe(false);
});

test("stopping the PR runtime discards an in-progress Git read before updating the database", async () => {
	const f = await fixture();
	mkdirSync(join(f.folder, ".git"));
	let entered!: () => void;
	const started = new Promise<void>((resolveStarted) => {
		entered = resolveStarted;
	});
	let release!: (value: {
		branch: string;
		headSha: string;
		upstream: null;
	}) => void;
	const refs = new Promise<{ branch: string; headSha: string; upstream: null }>(
		(resolveRefs) => {
			release = resolveRefs;
		},
	);
	const manager = new PullRequestRuntimeManager({
		db: f.db,
		git: f.ctx.git,
		execGh: f.ctx.execGh,
		github: f.ctx.github,
		gitWatcher: { onChanged: () => () => {} } as never,
		readWorkspaceRefs: () => {
			entered();
			return refs;
		},
	});
	const sync = (
		manager as unknown as { syncWorkspaceBranches(): Promise<void> }
	).syncWorkspaceBranches();
	await started;
	manager.stop();
	release({ branch: "late", headSha: "late", upstream: null });
	await sync;
	expect(
		f.db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, f.workspaceId))
			.get()?.branch,
	).toBe("");
});
