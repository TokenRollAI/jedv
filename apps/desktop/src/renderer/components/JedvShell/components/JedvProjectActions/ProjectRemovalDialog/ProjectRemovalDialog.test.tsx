import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Project } from "../../../types";
import type { ProjectActionContext } from "../types";
import { ProjectRemovalDialog } from "./ProjectRemovalDialog";

afterEach(cleanup);
const project = {
	id: "project-1",
	name: "Fixture project",
	repoPath: "/fixture/repo",
} as Project;
function fixture({
	failure = false,
	unsaved = false,
	getUnsaved = undefined as (() => boolean) | undefined,
} = {}) {
	const remove = mock(async () => {});
	const context = {
		hostUrl: "http://fixture.invalid",
		hostLabel: "Fixture host",
		client: {
			project: {
				deletionImpact: {
					query: async () => [
						{
							workspaceId: "workspace-1",
							name: "Local checkout",
							runningTerminalCount: 1,
							runningAgentCount: 1,
						},
					],
				},
			},
			workspace: {
				list: {
					query: async () => [
						{
							id: "workspace-1",
							projectId: project.id,
							name: "Local checkout",
							branch: "main",
						},
					],
				},
			},
			workspaceCleanup: {
				inspect: {
					query: async () => ({ canDelete: true, hasUnpushedCommits: false }),
				},
			},
			git: {
				getStatus: {
					query: async () => {
						if (failure) throw new Error("host offline");
						return {
							staged: [],
							unstaged: [{ path: "draft.ts" }],
							currentBranch: { aheadCount: 1 },
						};
					},
				},
			},
		},
	} as unknown as ProjectActionContext;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const screen = render(
		<QueryClientProvider client={queries}>
			<ProjectRemovalDialog
				project={project}
				context={context}
				hasUnsavedFiles={unsaved}
				getHasUnsavedFiles={getUnsaved}
				onClose={() => {}}
				onRemove={remove}
			/>
		</QueryClientProvider>,
	);
	return { remove, screen, queries, context };
}
test("project removal discloses dirty work and sessions and requires explicit acknowledgment", async () => {
	const f = fixture();
	await waitFor(() =>
		expect(
			f.screen.getByText(/Uncommitted changes and unpushed commits/),
		).toBeTruthy(),
	);
	const button = f.screen.getByRole("button", {
		name: "Remove project",
	}) as HTMLButtonElement;
	expect(button.disabled).toBe(true);
	expect(f.remove).not.toHaveBeenCalled();
	fireEvent.click(f.screen.getByRole("checkbox"));
	fireEvent.click(button);
	await waitFor(() =>
		expect(f.remove).toHaveBeenCalledWith(f.context, project),
	);
	f.queries.clear();
});
test("project removal is blocked when the target host cannot confirm its workspaces", async () => {
	const f = fixture({ failure: true });
	await waitFor(() =>
		expect(f.screen.getByRole("button", { name: "Retry checks" })).toBeTruthy(),
	);
	expect(
		(
			f.screen.getByRole("button", {
				name: "Remove project",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	expect(f.remove).not.toHaveBeenCalled();
	f.queries.clear();
});
test("unsaved editor buffers block removal even after acknowledging running sessions", async () => {
	const f = fixture({ unsaved: true });
	await waitFor(() => expect(f.screen.getByRole("checkbox")).toBeTruthy());
	fireEvent.click(f.screen.getByRole("checkbox"));
	expect(
		(
			f.screen.getByRole("button", {
				name: "Remove project",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	expect(f.remove).not.toHaveBeenCalled();
	f.queries.clear();
});

test("latest unsaved-file getter blocks removal even when the initial boolean was clean", async () => {
	let dirty = false;
	const f = fixture({ getUnsaved: () => dirty });
	await waitFor(() => expect(f.screen.getByRole("checkbox")).toBeTruthy());
	fireEvent.click(f.screen.getByRole("checkbox"));
	dirty = true;
	fireEvent.click(f.screen.getByRole("button", { name: "Remove project" }));
	await waitFor(() =>
		expect(
			f.screen.getAllByText(/Save or close all unsaved files/).length,
		).toBeGreaterThan(0),
	);
	expect(f.remove).not.toHaveBeenCalled();
	f.queries.clear();
});
