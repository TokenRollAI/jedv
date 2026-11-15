import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ProjectActionContext } from "../JedvProjectActions";
import { ActiveWorkspaceSwitcher } from "./ActiveWorkspaceSwitcher";

afterEach(cleanup);
test("real host queries drive selection and keep the opening context when props change", async () => {
	const workspaces = mock(async () => [
		{
			id: "workspace-1",
			name: "Original workspace",
			branch: "feature",
			archivedAt: null,
		},
	]);
	const bindings = mock(async () => [
		{
			workspaceId: "workspace-1",
			lastEventType: "PermissionRequest",
			endedAt: null,
		},
	]);
	const context = {
		hostUrl: "http://original.invalid",
		hostLabel: "Original host",
		isRemote: true,
		client: {
			workspace: { list: { query: workspaces } },
			terminalAgents: { list: { query: bindings } },
		},
	} as unknown as ProjectActionContext;
	const opened = mock(async (_input: unknown) => {});
	const closed = mock(() => {});
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = (target: ProjectActionContext) => (
		<QueryClientProvider client={cache}>
			<ActiveWorkspaceSwitcher
				context={target}
				onOpen={opened}
				onClose={closed}
			/>
		</QueryClientProvider>
	);
	const screen = render(view(context));
	await screen.findByText("Approval needed");
	expect(workspaces).toHaveBeenCalledTimes(1);
	expect(bindings).toHaveBeenCalledTimes(1);
	screen.rerender(
		view({
			...context,
			hostUrl: "http://different.invalid",
			client: {} as ProjectActionContext["client"],
		}),
	);
	fireEvent.click(screen.getByRole("option", { name: /Original workspace/ }));
	await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
	expect(opened.mock.calls[0]?.[0]).toEqual({
		context,
		workspaceId: "workspace-1",
	});
	expect(closed).toHaveBeenCalledTimes(1);
	cleanup();
	cache.clear();
});
