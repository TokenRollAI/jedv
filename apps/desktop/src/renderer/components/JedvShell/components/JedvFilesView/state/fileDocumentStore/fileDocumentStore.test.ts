// biome-ignore-all lint/style/noRestrictedImports: Isolated host filesystem smoke; this test is never imported by the renderer.
import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsHostService } from "@jedv/workspace-fs/host";
import type { LocalClient } from "renderer/components/JedvShell/local-client";
import { filesystemRouter } from "../../../../../../../../../../packages/host-service/src/trpc/router/filesystem/filesystem";
import type { HostServiceContext } from "../../../../../../../../../../packages/host-service/src/types";
import { withinWorkspace } from "../../utils/workspace-path";
import { createFileDocumentStore } from "./fileDocumentStore";
import type { SharedFileDocument } from "./types";

function loaded(document: SharedFileDocument): Promise<void> {
	if (document.content.kind !== "loading") return Promise.resolve();
	return new Promise((resolve) => {
		const unsubscribe = document.subscribe(() => {
			if (document.content.kind !== "loading") {
				unsubscribe();
				resolve();
			}
		});
	});
}

test("local file document uses host filesystem revision writes and keeps local edits on external conflict", async () => {
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "jedv-files-smoke-")),
	);
	const absolutePath = join(directory, "README.md");
	const service = createFsHostService({ rootPath: directory });
	const caller = filesystemRouter.createCaller({
		isAuthenticated: true,
		runtime: { filesystem: { getServiceForWorkspace: () => service } },
	} as unknown as HostServiceContext);
	const client = {
		filesystem: {
			readFile: { query: caller.readFile },
			writeFile: { mutate: caller.writeFile },
		},
	} as unknown as LocalClient;
	const store = createFileDocumentStore();
	try {
		await caller.writeFile({
			workspaceId: "isolated",
			absolutePath,
			content: "# Initial\n",
		});
		const document = store.acquireDocument("isolated", absolutePath, client);
		await loaded(document);
		expect(document.content.kind).toBe("text");
		expect(store.getDocument("isolated", absolutePath)?.id).toBe(document.id);
		document.setContent("# Saved via existing host API\n");
		expect((await document.save()).status).toBe("saved");
		expect(await readFile(absolutePath, "utf8")).toBe(
			"# Saved via existing host API\n",
		);
		document.setContent("# My unsaved buffer\n");
		await writeFile(
			absolutePath,
			"# External editor changed the file on disk\n",
		);
		store.dispatchFsEvent("isolated", { kind: "update", absolutePath });
		expect(document.hasExternalChange).toBe(true);
		expect((await document.save()).status).toBe("conflict");
		expect(document.content.kind === "text" && document.content.value).toBe(
			"# My unsaved buffer\n",
		);
		expect(document.conflict?.diskContent).toBe(
			"# External editor changed the file on disk\n",
		);
		expect(await readFile(absolutePath, "utf8")).toBe(
			"# External editor changed the file on disk\n",
		);
		await document.resolveConflict("keep");
		expect(document.dirty).toBe(true);
		await document.compareWithDisk();
		await document.resolveConflict("reload");
		expect(document.dirty).toBe(false);
		expect(document.content.kind === "text" && document.content.value).toBe(
			"# External editor changed the file on disk\n",
		);
		expect(
			withinWorkspace(directory, join(directory, "nested", "file.ts")),
		).toBe(true);
		expect(withinWorkspace(directory, `${directory}/../outside`)).toBe(false);
		expect(withinWorkspace(directory, `${directory}-other/file`)).toBe(false);
		await rm(absolutePath);
		store.dispatchFsEvent("isolated", { kind: "delete", absolutePath });
		expect(document.orphaned).toBe(true);
		store.releaseDocument("isolated", absolutePath);
		expect(store.getDocuments()).toEqual([]);
	} finally {
		await service.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test("large-file opt-in raises a finite limit and keeps it for later reads", async () => {
	const limits: Array<number | undefined> = [];
	let byteLength = 20 * 1024 * 1024;
	const client = {
		filesystem: {
			readFile: {
				query: async (input: { maxBytes?: number }) => {
					limits.push(input.maxBytes);
					return {
						kind: "text",
						content: "bounded fixture",
						revision: "1",
						byteLength,
						exceededLimit: byteLength > (input.maxBytes ?? Infinity),
					};
				},
			},
		},
	} as unknown as LocalClient;
	const store = createFileDocumentStore();
	const document = store.acquireDocument(
		"fixture",
		"/fixture/large.txt",
		client,
	);
	await loaded(document);
	expect(document.content.kind).toBe("too-large");
	await document.loadLargeFile();
	expect(document.content.kind).toBe("text");
	byteLength = 40 * 1024 * 1024;
	await document.reload();
	expect(document.content.kind).toBe("too-large");
	expect(limits).toEqual([
		10 * 1024 * 1024,
		32 * 1024 * 1024,
		32 * 1024 * 1024,
	]);
});
