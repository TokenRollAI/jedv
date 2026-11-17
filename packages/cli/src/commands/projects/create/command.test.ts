import { describe, expect, test } from "bun:test";
import path from "node:path";
import { withLocalHostService } from "../../../lib/host/test-helpers";
import automationsMeta from "../../automations/meta";
import createCommand from "./command";

let createInput: unknown;

withLocalHostService("org-1", {
	"project.capabilities": () => ({ folderProjects: true }),
	"project.create": (input: unknown) => {
		createInput = input;
		return { id: "proj-1", name: (input as { name: string }).name };
	},
});

function invoke(options: Record<string, unknown>) {
	return createCommand.run({
		ctx: { api: {}, config: { organizationId: "org-1" }, bearer: "b" } as never,
		args: {} as never,
		options: { local: true, ...options } as never,
		signal: new AbortController().signal,
	});
}

describe("projects create & automations meta", () => {
	test("automations command group exposes a help description", () => {
		expect(automationsMeta.description).toBe(
			"Manage scheduled and on-demand local agent automations",
		);
	});

	test("derives --name from directory basename when --import is passed without --name", async () => {
		createInput = undefined;
		const repoPath = "/tmp/my-imported-repo";
		const res = (await invoke({ import: repoPath })) as { message: string };
		expect(createInput).toEqual({
			name: path.basename(path.resolve(repoPath)),
			mode: { kind: "importLocal", repoPath },
		});
		expect(res.message).toContain("my-imported-repo");
	});

	test("derives --name from directory basename when --folder is passed without --name", async () => {
		createInput = undefined;
		const folderPath = "/tmp/my-folder-project/";
		const res = (await invoke({ folder: folderPath })) as { message: string };
		expect(createInput).toEqual({
			name: "my-folder-project",
			mode: { kind: "folder", repoPath: folderPath },
		});
		expect(res.message).toContain("my-folder-project");
	});

	test("still rejects --clone without --name", async () => {
		await expect(
			invoke({
				clone: "https://github.com/TokenRollAI/jedv.git",
				parentDir: "/tmp",
			}),
		).rejects.toThrow("Missing required option: --name");
	});
});
