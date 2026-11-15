import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ProjectActionContext } from "../../../JedvProjectActions";
import { ImportFromOtherTools } from "./ImportFromOtherTools";

afterEach(cleanup);
test("detection is explicit, import starts unselected, retries preserve IDs and original host", async () => {
	const detect = mock(async () => ({
		repos: [
			{
				repoPath: "/fixture/repo",
				name: "Fixture",
				worktrees: [
					{
						path: "/fixture/first",
						branch: "feature/first",
						source: "conductor",
					},
				],
			},
		],
	}));
	const create = mock(async (_input: { id: string }) => {
		if (create.mock.calls.length === 1) throw new Error("Permission denied");
		return { workspace: { id: "workspace-1" } };
	});
	const target = {
		hostUrl: "http://original.invalid",
		hostLabel: "Original host",
		isRemote: true,
		client: {
			project: {
				detectExternalWorktrees: { query: detect },
				findByPath: {
					query: async () => ({ candidates: [{ id: "project-1" }] }),
				},
			},
			workspaces: { create: { mutate: create } },
		},
	} as unknown as ProjectActionContext;
	const imported = mock(async (_input: unknown) => {});
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = (context: ProjectActionContext) => (
		<QueryClientProvider client={cache}>
			<ImportFromOtherTools context={context} onImported={imported} />
		</QueryClientProvider>
	);
	const screen = render(view(target));
	expect(detect).not.toHaveBeenCalled();
	fireEvent.click(
		screen.getByRole("button", { name: "Detect workspaces from other tools" }),
	);
	const checkbox = await screen.findByRole("checkbox");
	expect(detect).toHaveBeenCalledTimes(1);
	expect(checkbox.getAttribute("aria-checked")).toBe("false");
	expect(create).not.toHaveBeenCalled();
	expect(
		(
			screen.getByRole("button", {
				name: "Import selected",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	fireEvent.click(checkbox);
	fireEvent.click(screen.getByRole("button", { name: "Import selected" }));
	await screen.findByText("Permission denied");
	screen.rerender(
		view({
			...target,
			hostUrl: "http://different.invalid",
			client: {} as ProjectActionContext["client"],
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Retry failed imports" }));
	await screen.findByText("1 imported, 0 failed. Successful imports are kept.");
	expect(create).toHaveBeenCalledTimes(2);
	expect(create.mock.calls[0]?.[0].id).toBe(create.mock.calls[1]?.[0].id);
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await waitFor(() => expect(imported).toHaveBeenCalledTimes(1));
	expect(imported.mock.calls[0]?.[0]).toEqual({
		context: target,
		projectId: "project-1",
		workspaceIds: ["workspace-1"],
	});
	cache.clear();
});
