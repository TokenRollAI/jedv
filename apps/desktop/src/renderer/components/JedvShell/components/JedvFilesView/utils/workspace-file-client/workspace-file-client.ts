import { i18n } from "@jedv/i18n";
import { msg } from "@lingui/core/macro";
import type { LocalClient } from "renderer/components/JedvShell/local-client";
import { isAbsoluteFilesystemPath } from "shared/absolute-paths";
import { withinWorkspace, workspaceRelativePath } from "../workspace-path";

function normalizedLinkTarget(directory: string, target: string): string {
	const combined = (
		isAbsoluteFilesystemPath(target) ? target : `${directory}/${target}`
	).replaceAll("\\", "/");
	const prefix = combined.startsWith("//")
		? "//"
		: combined.startsWith("/")
			? "/"
			: "";
	const parts: string[] = [];
	for (const part of combined.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return prefix + parts.join("/");
}

export async function assertWorkspaceFileTarget(
	client: LocalClient,
	workspaceId: string,
	rootPath: string,
	absolutePath: string,
	{
		followFinal = true,
		allowMissing = false,
	}: { followFinal?: boolean; allowMissing?: boolean } = {},
	depth = 0,
): Promise<void> {
	if (!withinWorkspace(rootPath, absolutePath) || depth > 16)
		throw new Error(
			i18n._(
				msg({
					message:
						"This file is outside the workspace or its symbolic link cannot be safely resolved",
				}),
			),
		);
	const relative = workspaceRelativePath(rootPath, absolutePath) ?? "";
	const parts = relative.split("/").filter(Boolean);
	let path = rootPath.replace(/\/$/, "");
	for (let index = 0; index < parts.length; index++) {
		path += `/${parts[index]}`;
		const final = index === parts.length - 1;
		if (final && !followFinal) return;
		const metadata = await client.filesystem.getMetadata.query({
			workspaceId,
			absolutePath: path,
		});
		if (!metadata) {
			return;
		}
		if (metadata.kind === "symlink") {
			if (!metadata.symlinkTarget)
				throw new Error(
					i18n._(msg({ message: "The symbolic link target is unavailable" })),
				);
			const target = normalizedLinkTarget(
				path.slice(0, path.lastIndexOf("/")),
				metadata.symlinkTarget,
			);
			const rest = parts.slice(index + 1).join("/");
			await assertWorkspaceFileTarget(
				client,
				workspaceId,
				rootPath,
				rest ? `${target}/${rest}` : target,
				{ followFinal, allowMissing },
				depth + 1,
			);
			return;
		}
	}
}

export function createWorkspaceFileClient(
	client: LocalClient,
	workspaceId: string,
	rootPath: string,
): LocalClient {
	const filesystem = new Proxy(client.filesystem, {
		get(target, key) {
			const procedure = Reflect.get(target, key);
			if (
				![
					"listDirectory",
					"readFile",
					"getMetadata",
					"writeFile",
					"createDirectory",
					"createUniqueEntry",
					"movePath",
					"copyPath",
					"deletePath",
					"removeEmptyDirectory",
					"removeFileIfUnchanged",
				].includes(String(key))
			)
				return procedure;
			return new Proxy(procedure, {
				get(procedureTarget, method) {
					const invoke = Reflect.get(procedureTarget, method);
					if (method !== "query" && method !== "mutate") return invoke;
					return async (input: Record<string, unknown>, ...args: unknown[]) => {
						if (input.workspaceId !== workspaceId)
							throw new Error(
								i18n._(msg({ message: "The workspace changed" })),
							);
						const paths =
							key === "createUniqueEntry"
								? ["parentAbsolutePath"]
								: key === "movePath" || key === "copyPath"
									? ["sourceAbsolutePath", "destinationAbsolutePath"]
									: ["absolutePath"];
						for (const field of paths) {
							const path = input[field];
							if (typeof path !== "string")
								throw new Error(
									i18n._(msg({ message: "The file path is unavailable" })),
								);
							await assertWorkspaceFileTarget(
								client,
								workspaceId,
								rootPath,
								path,
								{
									followFinal: ![
										"getMetadata",
										"deletePath",
										"movePath",
										"copyPath",
										"removeEmptyDirectory",
										"removeFileIfUnchanged",
									].includes(String(key)),
									allowMissing:
										field === "destinationAbsolutePath" ||
										key === "writeFile" ||
										key === "createDirectory",
								},
							);
						}
						return Reflect.apply(invoke, procedureTarget, [input, ...args]);
					};
				},
			});
		},
	});
	return new Proxy(client, {
		get(target, key) {
			return key === "filesystem" ? filesystem : Reflect.get(target, key);
		},
	});
}
