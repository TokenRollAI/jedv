import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ProjectSettings } from "./ProjectSettings";
import type { ProjectSettingsContext } from "./types";

afterEach(cleanup);
test("project settings never write configuration before an explicit Save", async () => {
	const write = mock(async (_input: unknown) => ({
		path: "/fixture/.jedv/config.toml",
	}));
	const update = mock(async () => ({}));
	const context = {
		hostUrl: "http://original.invalid",
		client: {
			project: {
				get: {
					query: async () => ({
						id: "p",
						name: "Fixture",
						repoPath: "/fixture",
						repoPathExists: true,
						repoOwner: null,
						repoUrl: null,
						icon: null,
						color: null,
						branchPrefixMode: null,
						branchPrefixCustom: null,
						namingInstructions: null,
						sparseCheckoutPaths: [],
						worktreeBaseDir: null,
					}),
				},
				update: { mutate: update },
			},
			config: {
				getConfigFiles: {
					query: async () => ({
						shared: null,
						local: { path: "/fixture/.jedv/config.local.toml", content: null },
						tomlPath: "/fixture/.jedv/config.toml",
					}),
				},
				writeConfigFile: { mutate: write },
			},
		},
	} as unknown as ProjectSettingsContext;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const screen = render(
		<QueryClientProvider client={queries}>
			<ProjectSettings
				context={context}
				projectId="p"
				onChanged={async () => {}}
			/>
		</QueryClientProvider>,
	);
	await waitFor(() =>
		expect(screen.getAllByLabelText("Config file contents").length).toBe(2),
	);
	expect(write).not.toHaveBeenCalled();
	expect(update).not.toHaveBeenCalled();
	fireEvent.change(
		screen.getAllByLabelText("Config file contents")[0] as HTMLTextAreaElement,
		{ target: { value: "[setup]\nrun = []\n" } },
	);
	const editor = (
		screen.getAllByLabelText("Config file contents")[0] as HTMLElement
	).parentElement;
	const save = editor?.querySelector("button");
	expect(save).toBeTruthy();
	if (save) fireEvent.click(save);
	await waitFor(() => expect(write).toHaveBeenCalled());
	expect(write.mock.calls[0]?.[0]).toMatchObject({
		projectId: "p",
		file: "shared",
		format: "toml",
		content: "[setup]\nrun = []\n",
	});
});
