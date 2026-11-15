import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Workspace } from "../../../../types";
import type { ProjectActionContext } from "../../../JedvProjectActions";
import {
	moveWorkspaceInScope,
	orderedWorkspaceIds,
	useWorkspacePresentation,
} from "./useWorkspacePresentation";

afterEach(cleanup);
test("manual ordering keeps all scope IDs, including IDs not moved", () => {
	expect(
		orderedWorkspaceIds(
			[{ id: "a" }, { id: "b" }, { id: "c" }],
			[{ workspaceId: "b", position: 0 }],
		),
	).toEqual(["b", "a", "c"]);
	expect(moveWorkspaceInScope(["a", "b", "c"], "b", 1)).toEqual([
		"a",
		"c",
		"b",
	]);
});
test("reorder rejects partial or stale scopes before any backend write", async () => {
	const reorder = mock(async (_input: unknown) => ({ success: true }));
	const pin = mock(async () => ({ success: true }));
	const workspaces = [
		{ id: "a", projectId: "p" },
		{ id: "b", projectId: "p" },
	] as Workspace[];
	const context = {
		client: {
			settings: {
				workspacePresentation: {
					list: { query: async () => [] },
					reorder: { mutate: reorder },
					setPinned: { mutate: pin },
				},
			},
			workspace: { list: { query: async () => workspaces } },
		},
		hostUrl: "http://original.invalid",
		hostLabel: "Fixture",
		isRemote: true,
	} as unknown as ProjectActionContext;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const { result } = renderHook(
		() => useWorkspacePresentation(context, workspaces),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={queries}>{children}</QueryClientProvider>
			),
		},
	);
	await waitFor(() => expect(result.current.available).toBe(true));
	await act(async () => {
		await expect(result.current.reorder("p", ["a"])).rejects.toThrow(
			"workspace list changed",
		);
	});
	expect(reorder).not.toHaveBeenCalled();
	await act(async () => {
		await result.current.reorder("p", ["b", "a"]);
	});
	expect(reorder).toHaveBeenCalledWith({
		projectId: "p",
		workspaceIds: ["b", "a"],
	});
});
