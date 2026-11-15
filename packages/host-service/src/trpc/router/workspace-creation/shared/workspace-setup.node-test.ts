import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { Server } from "@jedv/pty-daemon";
import { createDb, type HostDb } from "../../../../db/index.ts";
import { projects, workspaces } from "../../../../db/schema.ts";
import type { EventBus } from "../../../../events/index.ts";
import {
	disposeDaemonClient,
	getDaemonClient,
} from "../../../../terminal/daemon-client-singleton.ts";
import { initTerminalBaseEnv } from "../../../../terminal/env.ts";
import {
	__resetSessionsForTesting,
	createTerminalSessionInternal,
	disposeSessionAndWait,
} from "../../../../terminal/terminal.ts";
import { __setAccountShellForTesting } from "../../../../terminal/user-shell.ts";
import {
	getWorkspaceSetupStatus,
	recordWorkspaceSetupExit,
	recordWorkspaceSetupStart,
	recordWorkspaceSetupUnavailable,
	recoverWorkspaceSetupTerminals,
} from "./workspace-setup.ts";

const root = mkdtempSync(join(tmpdir(), "jedv-setup-pty-"));
const socketPath = join(tmpdir(), `jedv-setup-${process.pid}.sock`);
const workspaceId = randomUUID();
let server: Server;
let db: HostDb;

before(async () => {
	const checkout = join(root, "checkout");
	mkdirSync(checkout);
	process.env.JEDV_PTY_DAEMON_SOCKET = socketPath;
	process.env.JEDV_HOME_DIR = root;
	process.env.HOST_SERVICE_VERSION = "0.0.0-setup-fixture";
	process.env.NODE_ENV = "development";
	__setAccountShellForTesting("/bin/sh");
	initTerminalBaseEnv({
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: root,
		SHELL: "/bin/sh",
	});
	server = new Server({ socketPath, daemonVersion: "0.0.0-setup-fixture" });
	await server.listen();
	db = createDb(
		join(root, "fixture.db"),
		resolve(import.meta.dirname, "../../../../../drizzle"),
	);
	const projectId = randomUUID();
	db.insert(projects).values({ id: projectId, repoPath: checkout }).run();
	db.insert(workspaces)
		.values({
			id: workspaceId,
			projectId,
			worktreePath: checkout,
			branch: "main",
		})
		.run();
});

after(async () => {
	__resetSessionsForTesting();
	__setAccountShellForTesting(undefined);
	await disposeDaemonClient();
	await server?.close();
	db?.$client.close();
	rmSync(root, { recursive: true, force: true });
});

for (const code of [0, 7]) {
	test(
		`one-shot setup preserves a fast real PTY exit ${code}`,
		{ timeout: 5000 },
		async () => {
			const terminalId = randomUUID();
			const exited = Promise.withResolvers<{
				code: number | null;
				signal: number | null;
			}>();
			recordWorkspaceSetupStart(db, workspaceId, terminalId);
			const result = await createTerminalSessionInternal({
				terminalId,
				workspaceId,
				db,
				oneShotSetup: {
					command: `exit ${code}`,
					onExit: (info) => {
						recordWorkspaceSetupExit(db, workspaceId, terminalId, info);
						exited.resolve(info);
					},
				},
			});
			assert.ok(!("error" in result), "error" in result ? result.error : "");
			const info = await exited.promise;
			assert.equal(info.code, code);
			assert.equal(
				getWorkspaceSetupStatus(db, workspaceId)?.status,
				code === 0 ? "succeeded" : "failed",
			);
		},
	);
}

test(
	"disposing an owned setup without a raw exit leaves unknown evidence",
	{ timeout: 5000 },
	async () => {
		const terminalId = randomUUID();
		let receivedRawExit = false;
		recordWorkspaceSetupStart(db, workspaceId, terminalId);
		const result = await createTerminalSessionInternal({
			terminalId,
			workspaceId,
			db,
			oneShotSetup: {
				command: "IFS= read -r finish; exit 0",
				onExit: () => {
					receivedRawExit = true;
				},
				onLost: () =>
					recordWorkspaceSetupUnavailable(
						db,
						workspaceId,
						terminalId,
						"unknown",
					),
			},
		});
		assert.ok(!("error" in result), "error" in result ? result.error : "");
		await disposeSessionAndWait(terminalId, db);
		assert.equal(receivedRawExit, false);
		assert.equal(getWorkspaceSetupStatus(db, workspaceId)?.status, "unknown");
		assert.equal(getWorkspaceSetupStatus(db, workspaceId)?.exitCode, null);
	},
);

test(
	"host recovery adopts the owned setup PTY without starting a second command",
	{ timeout: 5000 },
	async () => {
		const terminalId = randomUUID();
		recordWorkspaceSetupStart(db, workspaceId, terminalId);
		const created = await createTerminalSessionInternal({
			terminalId,
			workspaceId,
			db,
			oneShotSetup: {
				command: "IFS= read -r finish; exit 0",
				onExit: () => {},
			},
		});
		assert.ok(!("error" in created), "error" in created ? created.error : "");
		__resetSessionsForTesting();
		const exited = Promise.withResolvers<void>();
		const eventBus = {
			broadcastTerminalLifecycle: (event: { eventType: string }) => {
				if (event.eventType === "exit") exited.resolve();
			},
		} as unknown as EventBus;
		const daemon = await getDaemonClient();
		const beforeIds = (await daemon.list()).map((session) => session.id);
		await recoverWorkspaceSetupTerminals({ db, eventBus });
		assert.deepEqual(
			(await daemon.list()).map((session) => session.id),
			beforeIds,
		);
		assert.equal(getWorkspaceSetupStatus(db, workspaceId)?.status, "running");
		const adopted = await createTerminalSessionInternal({
			terminalId,
			workspaceId,
			db,
			adoptOnly: true,
		});
		assert.ok(!("error" in adopted), "error" in adopted ? adopted.error : "");
		if ("error" in adopted) return;
		adopted.pty.writeOrThrow("\n");
		await exited.promise;
		assert.equal(getWorkspaceSetupStatus(db, workspaceId)?.status, "succeeded");
	},
);
