import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { workspaces } from "../../src/db/schema";
import { createTestHost } from "../helpers/createTestHost";

test("local host exposes only local routes and protects workspace reads", async () => {
	const host = await createTestHost({
		organizationId: "jedv-local",
	});
	try {
		expect(await host.trpc.project.list.query()).toEqual([]);
		expect(await host.trpc.workspace.list.query()).toEqual([]);
		await expect(
			host.unauthenticatedTrpc.project.list.query(),
		).rejects.toThrow();
		expect("api" in host).toBe(false);
		for (const route of [
			"pageWatch",
			"sandbox",
			"teleport",
			"issues",
			"system",
		]) {
			const response = await host.fetch(
				`http://host-service.test/trpc/${route}.list`,
				{ headers: { authorization: `Bearer ${host.psk}` } },
			);
			expect(response.status).toBe(404);
		}
	} finally {
		await host.dispose();
	}
});

test("local uploads materialize in a workspace without replacing existing files", async () => {
	const host = await createTestHost();
	try {
		const worktreePath = join(dirname(host.dbPath), "workspace");
		mkdirSync(worktreePath);
		host.db
			.insert(workspaces)
			.values({
				id: "local-attachments",
				projectId: null,
				type: "session",
				worktreePath,
				branch: "",
				name: "attachments",
			})
			.run();
		const uploaded = await host.trpc.attachments.upload.mutate({
			data: {
				kind: "base64",
				data: Buffer.from("local content").toString("base64"),
			},
			mediaType: "text/plain",
			originalFilename: "notes.txt",
		});
		const first = await host.trpc.attachments.materializeIntoWorkspace.mutate({
			workspaceId: "local-attachments",
			attachmentIds: [uploaded.attachmentId],
		});
		writeFileSync(join(worktreePath, first.paths[0] ?? ""), "user content");
		const second = await host.trpc.attachments.materializeIntoWorkspace.mutate({
			workspaceId: "local-attachments",
			attachmentIds: [uploaded.attachmentId],
		});
		expect(second.paths[0]).not.toBe(first.paths[0]);
		expect(readFileSync(join(worktreePath, first.paths[0] ?? ""), "utf8")).toBe(
			"user content",
		);
		expect(
			readFileSync(join(worktreePath, second.paths[0] ?? ""), "utf8"),
		).toBe("local content");
	} finally {
		await host.dispose();
	}
});
