import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ProjectSettingsContext } from "../types";
import { DeletedProjectsPanel } from "./DeletedProjectsPanel";

afterEach(cleanup);
function fixture() {
	let removed = true;
	const restore = mock(async (_input: unknown) => {
		removed = false;
		return { restoredWorkspaceCount: 1 };
	});
	const purge = mock(async (_input: unknown) => {
		removed = false;
		return { success: true };
	});
	const context = {
		hostUrl: "http://original.invalid",
		client: {
			project: {
				listDeleted: {
					query: async () =>
						removed
							? [
									{
										id: "removed-1",
										name: "Removed fixture",
										repoPath: "/fixture",
										deletedAt: 1,
										purgeAt: 2000000000000,
										workspaceCount: 1,
									},
								]
							: [],
				},
				restore: { mutate: restore },
				purge: { mutate: purge },
			},
		},
	} as unknown as ProjectSettingsContext;
	const changed = mock(async (_context: unknown) => {});
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const screen = render(
		<QueryClientProvider client={queries}>
			<DeletedProjectsPanel context={context} onChanged={changed} />
		</QueryClientProvider>,
	);
	return { restore, purge, changed, screen };
}
test("restoring a removed project uses project.restore only after the explicit action", async () => {
	const f = fixture();
	await waitFor(() =>
		expect(f.screen.getByText("Removed fixture")).toBeTruthy(),
	);
	expect(f.restore).not.toHaveBeenCalled();
	fireEvent.click(f.screen.getByRole("button", { name: "Restore" }));
	await waitFor(() => expect(f.changed).toHaveBeenCalled());
	expect(f.restore).toHaveBeenCalledWith({ projectId: "removed-1" });
	expect(f.purge).not.toHaveBeenCalled();
});
test("permanent project removal requires the matching name and never calls workspace.delete", async () => {
	const f = fixture();
	await waitFor(() =>
		expect(f.screen.getByText("Removed fixture")).toBeTruthy(),
	);
	fireEvent.click(
		f.screen.getByRole("button", { name: "Delete permanently…" }),
	);
	const confirm = f.screen.getByRole("button", {
		name: "Delete permanently",
	}) as HTMLButtonElement;
	expect(confirm.disabled).toBe(true);
	expect(f.purge).not.toHaveBeenCalled();
	fireEvent.change(f.screen.getByLabelText("Type project name to confirm"), {
		target: { value: "Removed fixture" },
	});
	fireEvent.click(confirm);
	await waitFor(() =>
		expect(f.purge).toHaveBeenCalledWith({ projectId: "removed-1" }),
	);
});
