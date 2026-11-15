// biome-ignore-all lint/style/noRestrictedImports: Isolated API fixture; never imported by the renderer.
import { expect, test } from "bun:test";
import { mkdtemp, realpath, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsHostService } from "@jedv/workspace-fs/host";
import type { LocalClient } from "renderer/components/JedvShell/local-client";
import { filesystemRouter } from "../../../../../../../../../../packages/host-service/src/trpc/router/filesystem/filesystem";
import type { HostServiceContext } from "../../../../../../../../../../packages/host-service/src/types";
import { createFileDocumentStore } from "../../state/fileDocumentStore/fileDocumentStore";
import { createWorkspaceFileClient } from "./workspace-file-client";

test("Files navigation adapter follows internal links and preserves dirty documents through real move and folder deletion", async () => {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "jedv-files-parity-")),
	);
	const service = createFsHostService({ rootPath: root });
	const caller = filesystemRouter.createCaller({
		isAuthenticated: true,
		runtime: { filesystem: { getServiceForWorkspace: () => service } },
	} as unknown as HostServiceContext);
	const filesystem = Object.fromEntries([
		...["readFile", "getMetadata", "listDirectory", "searchFiles"].map(
			(name) => [name, { query: Reflect.get(caller, name) }],
		),
		...[
			"writeFile",
			"createDirectory",
			"createUniqueEntry",
			"removeEmptyDirectory",
			"removeFileIfUnchanged",
			"movePath",
			"copyPath",
			"deletePath",
		].map((name) => [name, { mutate: Reflect.get(caller, name) }]),
	]);

	const raw = { filesystem } as unknown as LocalClient;
	const client = createWorkspaceFileClient(raw, "fixture", root);
	const input = { workspaceId: "fixture" };
	try {
		const folder = join(root, "folder");
		await client.filesystem.createDirectory.mutate({
			...input,
			absolutePath: folder,
		});
		const file = join(folder, "中文.ts");
		const saved = await client.filesystem.writeFile.mutate({
			...input,
			absolutePath: file,
			content: "export const count = 1;\n",
			options: { create: true, overwrite: false },
		});
		expect(saved.ok).toBe(true);
		const store = createFileDocumentStore();
		const document = store.acquireDocument("fixture", file, client);
		await new Promise<void>((resolve) => {
			if (document.content.kind !== "loading") return resolve();
			const release = document.subscribe(() => {
				if (document.content.kind !== "loading") {
					release();
					resolve();
				}
			});
		});
		document.setContent("export const count = 2;\n");
		expect(document.dirty).toBe(true);
		const destination = join(folder, "renamed.ts");
		await client.filesystem.movePath.mutate({
			...input,
			sourceAbsolutePath: file,
			destinationAbsolutePath: destination,
		});
		store.dispatchFsEvent("fixture", {
			kind: "rename",
			oldAbsolutePath: file,
			absolutePath: destination,
			isDirectory: false,
		});
		expect(document.absolutePath).toBe(destination);
		expect(document.dirty).toBe(true);
		expect(store.getDocument("fixture", destination)?.id).toBe(document.id);
		expect(store.getDocument("fixture", file)).toBe(null);
		const copy = join(folder, "copy.ts");
		await client.filesystem.copyPath.mutate({
			...input,
			sourceAbsolutePath: destination,
			destinationAbsolutePath: copy,
		});
		const copied = await client.filesystem.readFile.query({
			...input,
			absolutePath: copy,
			encoding: "utf8",
		});
		expect(copied.kind === "text" && copied.content).toBe(
			"export const count = 1;\n",
		);
		await expect(
			client.filesystem.movePath.mutate({
				...input,
				sourceAbsolutePath: destination,
				destinationAbsolutePath: copy,
			}),
		).rejects.toThrow();
		await symlink("folder/renamed.ts", join(root, "internal-link"));
		const linked = await client.filesystem.readFile.query({
			...input,
			absolutePath: join(root, "internal-link"),
			encoding: "utf8",
		});
		expect(linked.kind === "text" && linked.content).toBe(
			"export const count = 1;\n",
		);
		await symlink(tmpdir(), join(root, "outside-link"));
		await expect(
			client.filesystem.listDirectory.query({
				...input,
				absolutePath: join(root, "outside-link"),
			}),
		).rejects.toThrow();
		await expect(
			client.filesystem.readFile.query({
				...input,
				absolutePath: join(root, "../outside"),
			}),
		).rejects.toThrow();
		const provisional = await client.filesystem.createUniqueEntry.mutate({
			...input,
			parentAbsolutePath: root,
			baseName: "Untitled",
			kind: "file",
		});
		expect(provisional.ok).toBe(true);
		if (provisional.ok && provisional.revision) {
			expect(
				(
					await client.filesystem.removeFileIfUnchanged.mutate({
						...input,
						absolutePath: provisional.absolutePath,
						revision: provisional.revision,
					})
				).ok,
			).toBe(true);
		}
		const replacement = store.acquireDocument("fixture", copy, client);
		await new Promise<void>((resolve) => {
			if (replacement.content.kind !== "loading") return resolve();
			const release = replacement.subscribe(() => {
				if (replacement.content.kind !== "loading") {
					release();
					resolve();
				}
			});
		});
		replacement.setContent("export const count = 3;\n");
		await client.filesystem.writeFile.mutate({
			...input,
			absolutePath: destination,
			content: "export const count = 4;\n",
		});
		await rename(destination, copy);
		store.dispatchFsEvent("fixture", {
			kind: "rename",
			oldAbsolutePath: destination,
			absolutePath: copy,
			isDirectory: false,
		});
		await new Promise<void>((resolve) => {
			if (replacement.hasExternalChange) return resolve();
			const release = replacement.subscribe(() => {
				if (replacement.hasExternalChange) {
					release();
					resolve();
				}
			});
		});
		expect(document.orphaned).toBe(true);
		expect(replacement.dirty).toBe(true);
		expect(store.getDocument("fixture", copy)?.id).toBe(replacement.id);
		expect(store.getDocument("fixture", destination)?.id).toBe(document.id);
		await client.filesystem.deletePath.mutate({
			...input,
			absolutePath: folder,
			permanent: true,
		});
		store.dispatchFsEvent("fixture", {
			kind: "delete",
			absolutePath: folder,
			isDirectory: true,
		});
		expect(document.orphaned).toBe(true);
		expect(document.content.kind === "text" && document.content.value).toBe(
			"export const count = 2;\n",
		);
		store.releaseDocument("fixture", destination, { discard: true });
		store.releaseDocument("fixture", copy, { discard: true });
		expect(store.getDocuments()).toEqual([]);
	} finally {
		await service.close();
		await rm(root, { recursive: true, force: true });
	}
});
