import { expect, mock, test } from "bun:test";
import type { ProjectActionContext } from "../../../JedvProjectActions";
import {
	moveTreeGroup,
	openTreeEditor,
	stopTreeWorkspaceForwards,
	stopTreeWorkspaceListeners,
	type TreeListener,
	type TreeNativeClient,
} from "./tree-api";

test("forward stop rechecks and touches only confirmed IDs for the original host and workspace", async () => {
	const stop = mock(async (_input: unknown) => []);
	const native = {
		portForwards: {
			list: {
				query: async () => [
					{ id: "yes", target: { hostUrl: "original", workspaceId: "w" } },
					{
						id: "another-host",
						target: { hostUrl: "different", workspaceId: "w" },
					},
					{
						id: "new-unconfirmed",
						target: { hostUrl: "original", workspaceId: "w" },
					},
					{
						id: "another-workspace",
						target: { hostUrl: "original", workspaceId: "else" },
					},
				],
			},
			stopForward: { mutate: stop },
		},
	} as unknown as TreeNativeClient;
	await stopTreeWorkspaceForwards(
		native,
		{ hostUrl: "original" } as ProjectActionContext,
		"w",
		["yes", "another-host", "another-workspace"],
	);
	expect(stop.mock.calls.map((row) => row[0])).toEqual([{ id: "yes" }]);
});
test("editor opens an absolute local target with configured app and never projects a remote path onto this machine", async () => {
	const open = mock(async (_input: unknown) => {});
	const native = {
		external: { openFileInEditor: { mutate: open } },
	} as unknown as TreeNativeClient;
	await openTreeEditor(
		native,
		{ isRemote: true } as ProjectActionContext,
		"/remote/repo",
		"vscode",
	);
	await openTreeEditor(
		native,
		{ isRemote: false } as ProjectActionContext,
		"/fixture/repo",
		null,
	);
	expect(open).toHaveBeenCalledTimes(1);
	expect(open).toHaveBeenCalledWith({
		path: "/fixture/repo",
		app: undefined,
	});
	await openTreeEditor(
		native,
		{ isRemote: false } as ProjectActionContext,
		"/fixture/repo",
		"vscode",
	);
	expect(open).toHaveBeenCalledWith({ path: "/fixture/repo", app: "vscode" });
});
test("group reordering persists presentation on the original scope without changing workspace tags", async () => {
	const upsert = mock(async (_input: unknown) => ({}));
	const context = {
		client: { tagFolders: { upsert: { mutate: upsert } } },
	} as unknown as ProjectActionContext;
	await moveTreeGroup(
		context,
		"project",
		[
			{ tag: "one", name: "First", color: null, order: 0 },
			{ tag: "two", name: "Second", color: null, order: 1 },
		],
		"two",
		-1,
	);
	expect(upsert.mock.calls.map((row) => row[0])).toEqual([
		{ scope: "project", tag: "two", tabOrder: 0 },
		{ scope: "project", tag: "one", tabOrder: 1 },
	]);
});

test("listener confirmation rechecks original PID and refuses a replaced process without sending kill", async () => {
	const row = {
		workspaceId: "w",
		terminalId: "t",
		port: 3000,
		pid: 123,
		processName: "fixture-server",
		address: "127.0.0.1",
		detectedAt: 1,
	} as TreeListener;
	const kill = mock(async (_input: unknown) => ({ success: true }));
	let current = { ...row, pid: 124 };
	const context = {
		client: {
			ports: {
				getAll: { query: async () => [current] },
				kill: { mutate: kill },
			},
		},
	} as unknown as ProjectActionContext;
	const messages = { changed: "Process changed", failed: "Failed" };
	await expect(
		stopTreeWorkspaceListeners(context, "w", [row], messages),
	).rejects.toThrow("Process changed");
	expect(kill).not.toHaveBeenCalled();
	current = row;
	await stopTreeWorkspaceListeners(context, "w", [row], messages);
	expect(kill).toHaveBeenCalledWith({
		workspaceId: "w",
		terminalId: "t",
		port: 3000,
	});
});
