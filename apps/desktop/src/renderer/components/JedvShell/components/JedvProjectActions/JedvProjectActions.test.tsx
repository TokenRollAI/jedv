import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { JedvProjectActions } from "./JedvProjectActions";
import type { JedvProjectActionsHandle, ProjectActionContext } from "./types";

afterEach(cleanup);
function fixture() {
	const create = mock(
		async (
			_input: unknown,
			_options?: { signal?: AbortSignal; context?: { skipBatch?: boolean } },
		) => ({
			projectId: "project-1",
			repoPath: "/fixture/repo",
			created: true,
		}),
	);
	const find = mock(async (_input: unknown) => ({
		candidates: [] as { id: string; name: string }[],
		needsGitInit: true,
	}));
	const operation = mock(async (_input: unknown) => ({
		status: "unknown" as "unknown" | "running" | "cancelled" | "failed",
	}));
	const browse = mock(async () => ({
		path: "/fixture",
		homePath: "/fixture",
		parentPath: "/",
		entries: [] as unknown[],
	}));
	const workspace = mock(async (_input: unknown) => ({
		workspace: { id: "workspace-1" },
	}));
	const list = mock(async () => []);
	const context = {
		hostUrl: "http://original.invalid",
		hostLabel: "Original host",
		isRemote: true,
		client: {
			project: {
				capabilities: { query: async () => ({ folderProjects: true }) },
				create: { mutate: create },
				findByPath: { query: find },
				getCreateOperation: { query: operation },
				list: { query: list },
			},
			workspace: { list: { query: async () => [] } },
			workspaces: { create: { mutate: workspace } },
			filesystem: {
				browseHost: {
					query: browse,
				},
			},
		},
	} as unknown as ProjectActionContext;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const ref = createRef<JedvProjectActionsHandle>();
	const opened = mock(async (_result: unknown) => {});
	const refreshed = mock(async (_context: unknown) => {});
	const screen = render(
		<QueryClientProvider client={queries}>
			<JedvProjectActions
				ref={ref}
				context={context}
				onOpened={opened}
				onRefresh={refreshed}
			/>
		</QueryClientProvider>,
	);
	return {
		create,
		operation,
		browse,
		find,
		workspace,
		list,
		context,
		queries,
		ref,
		opened,
		refreshed,
		screen,
	};
}

test("template browsing is static; explicit creation uses the snapshot API and never runs setup", async () => {
	const f = fixture();
	act(() => f.ref.current?.open("template"));
	await waitFor(() =>
		expect(f.screen.getByText("React Router + Hono")).toBeTruthy(),
	);
	expect(f.create).not.toHaveBeenCalled();
	fireEvent.click(f.screen.getByRole("button", { name: /Next.js Vercel/ }));
	await waitFor(() =>
		expect(
			(f.screen.getByLabelText("Location") as HTMLInputElement).value,
		).toBe("/fixture/.jedv/projects"),
	);
	expect(f.create).not.toHaveBeenCalled();
	fireEvent.click(f.screen.getByRole("button", { name: "Create project" }));
	await waitFor(() => expect(f.opened).toHaveBeenCalled());
	expect(f.create.mock.calls[0]?.[0]).toMatchObject({
		name: "nextjs-postgres-auth-starter",
		mode: {
			kind: "template",
			parentDir: "/fixture/.jedv/projects",
			url: "https://github.com/vercel/nextjs-postgres-auth-starter",
		},
	});
	expect(f.workspace.mock.calls[0]).toEqual([
		{ projectId: "project-1", checkout: "local", runSetup: false },
	]);
	f.queries.clear();
});

test("non-git import waits for explicit confirmation and cancel leaves the host untouched", async () => {
	const f = fixture();
	await act(async () => {
		f.ref.current?.open("open", "/fixture/plain");
	});
	await waitFor(() =>
		expect(f.screen.getByText("Initialize Git repository?")).toBeTruthy(),
	);
	expect(f.create).not.toHaveBeenCalled();
	await act(async () => {
		fireEvent.click(f.screen.getByRole("button", { name: "Cancel" }));
	});
	await waitFor(() => expect(f.screen.queryByRole("dialog")).toBeNull());
	expect(f.create).not.toHaveBeenCalled();
	expect(f.workspace).not.toHaveBeenCalled();
	f.queries.clear();
});

test("project saved before checkout failure is resumed without creating it twice", async () => {
	const f = fixture();
	f.workspace.mockImplementationOnce(async () => {
		throw new Error("checkout unavailable");
	});
	act(() => f.ref.current?.open("empty"));
	await waitFor(() =>
		expect(
			(f.screen.getByLabelText("Location") as HTMLInputElement).value,
		).toBe("/fixture/.jedv/projects"),
	);
	fireEvent.change(f.screen.getByLabelText("Project name"), {
		target: { value: "my-project" },
	});
	fireEvent.click(f.screen.getByRole("button", { name: "Create project" }));
	await waitFor(() =>
		expect(
			f.screen.getByRole("button", { name: "Continue opening" }),
		).toBeTruthy(),
	);
	expect(f.screen.getByRole("alert").textContent).toContain("project is saved");
	fireEvent.click(f.screen.getByRole("button", { name: "Continue opening" }));
	await waitFor(() => expect(f.opened).toHaveBeenCalledTimes(1));
	expect(f.create).toHaveBeenCalledTimes(1);
	expect(f.workspace).toHaveBeenCalledTimes(2);
	f.queries.clear();
});

test("clone cancellation aborts the real request and requires a result check before retry", async () => {
	const f = fixture();
	let signal: AbortSignal | undefined;
	f.create.mockImplementation(
		(_input, _options) =>
			new Promise((_resolve, reject) => {
				signal = _options?.signal;
				signal?.addEventListener(
					"abort",
					() => reject(new Error("cancelled")),
					{ once: true },
				);
			}),
	);
	act(() => f.ref.current?.open("clone"));
	await waitFor(() =>
		expect(
			(f.screen.getByLabelText("Location") as HTMLInputElement).value,
		).toBe("/fixture/.jedv/projects"),
	);
	fireEvent.change(f.screen.getByLabelText("Repository URL or path"), {
		target: { value: "https://example.test/repo.git" },
	});
	fireEvent.click(f.screen.getByRole("button", { name: "Clone repository" }));
	await waitFor(() => expect(signal).toBeTruthy());
	fireEvent.click(
		f.screen.getByRole("button", { name: "Request cancellation" }),
	);
	await waitFor(() => expect(signal?.aborted).toBe(true));
	await waitFor(() =>
		expect(f.screen.getByRole("button", { name: "Check result" })).toBeTruthy(),
	);
	expect(f.find).toHaveBeenCalledWith({
		repoPath: "/fixture/.jedv/projects/repo",
	});
	fireEvent.click(f.screen.getByRole("button", { name: "Check result" }));
	await waitFor(() => expect(f.find).toHaveBeenCalledTimes(2));
	expect(f.create).toHaveBeenCalledTimes(1);
	expect(f.opened).not.toHaveBeenCalled();
	f.queries.clear();
});

test("an operation completes against its original host after the active host changes", async () => {
	const f = fixture();
	let resolveCreate:
		| ((result: {
				projectId: string;
				repoPath: string;
				created: boolean;
		  }) => void)
		| undefined;
	f.create.mockImplementation(
		() =>
			new Promise((resolve) => {
				resolveCreate = resolve;
			}),
	);
	act(() => f.ref.current?.open("empty"));
	await waitFor(() =>
		expect(
			(f.screen.getByLabelText("Location") as HTMLInputElement).value,
		).toBe("/fixture/.jedv/projects"),
	);
	fireEvent.change(f.screen.getByLabelText("Project name"), {
		target: { value: "my-project" },
	});
	fireEvent.click(f.screen.getByRole("button", { name: "Create project" }));
	await waitFor(() => expect(resolveCreate).toBeTruthy());
	const other = {
		...f.context,
		hostUrl: "http://other.invalid",
		hostLabel: "Other host",
	};
	f.screen.rerender(
		<QueryClientProvider client={f.queries}>
			<JedvProjectActions
				ref={f.ref}
				context={other}
				onOpened={f.opened}
				onRefresh={f.refreshed}
			/>
		</QueryClientProvider>,
	);
	await act(async () => {
		resolveCreate?.({
			projectId: "project-1",
			repoPath: "/fixture/my-project",
			created: true,
		});
	});
	await waitFor(() => expect(f.opened).toHaveBeenCalledTimes(1));
	expect(f.opened.mock.calls[0]?.[0]).toMatchObject({
		context: { hostUrl: "http://original.invalid" },
		projectId: "project-1",
		workspaceId: "workspace-1",
	});
	expect(f.refreshed.mock.calls[0]?.[0]).toMatchObject({
		hostUrl: "http://original.invalid",
	});
	expect(
		f.queries.getQueryData(["jedv", "http://other.invalid", "projects"]),
	).toBeUndefined();
	f.queries.clear();
});

test("template cancellation sends a signal and trusts only a settled operation status", async () => {
	const f = fixture();
	f.operation.mockImplementation(async () => ({ status: "cancelled" }));
	f.create.mockImplementation(
		(_input, options) =>
			new Promise((_resolve, reject) => {
				options?.signal?.addEventListener(
					"abort",
					() => reject(new Error("cancelled")),
					{ once: true },
				);
			}),
	);
	act(() => f.ref.current?.open("template"));
	await waitFor(() =>
		expect(f.screen.getByText("React Router + Hono")).toBeTruthy(),
	);
	fireEvent.click(f.screen.getByRole("button", { name: /Next.js Vercel/ }));
	await waitFor(() =>
		expect(
			(f.screen.getByLabelText("Location") as HTMLInputElement).value,
		).toBe("/fixture/.jedv/projects"),
	);
	fireEvent.click(f.screen.getByRole("button", { name: "Create project" }));
	await waitFor(() => expect(f.create).toHaveBeenCalledTimes(1));
	fireEvent.click(
		f.screen.getByRole("button", { name: "Request cancellation" }),
	);
	await waitFor(() =>
		expect(
			f.screen.getByText(/confirmed this operation has stopped/),
		).toBeTruthy(),
	);
	expect(f.create.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
	expect(f.find).not.toHaveBeenCalled();
	f.queries.clear();
});

test("selecting a template before home discovery resolves preserves the draft and fills the default folder", async () => {
	const f = fixture();
	let resolveHome:
		| ((value: {
				path: string;
				homePath: string;
				parentPath: string;
				entries: unknown[];
		  }) => void)
		| undefined;
	f.browse.mockImplementation(
		() =>
			new Promise((resolve) => {
				resolveHome = resolve;
			}),
	);
	act(() => f.ref.current?.open("template"));
	fireEvent.click(f.screen.getByRole("button", { name: /Next.js Vercel/ }));
	fireEvent.change(f.screen.getByLabelText("Project name"), {
		target: { value: "中文项目" },
	});
	await act(async () => {
		resolveHome?.({
			path: "/home/fixture",
			homePath: "/home/fixture",
			parentPath: "/home",
			entries: [],
		});
	});
	await waitFor(() =>
		expect(
			(f.screen.getByLabelText("Location") as HTMLInputElement).value,
		).toBe("/home/fixture/.jedv/projects"),
	);
	expect(
		(f.screen.getByLabelText("Project name") as HTMLInputElement).value,
	).toBe("中文项目");
	f.queries.clear();
});
test("only a settled cancelled operation releases the clone target for a new attempt", async () => {
	const f = fixture();
	f.operation.mockImplementation(async () => ({ status: "cancelled" }));
	f.create.mockImplementation(
		(_input, options) =>
			new Promise((_resolve, reject) => {
				options?.signal?.addEventListener(
					"abort",
					() => reject(new Error("cancelled")),
					{ once: true },
				);
			}),
	);
	act(() => f.ref.current?.open("clone"));
	await waitFor(() =>
		expect(
			(f.screen.getByLabelText("Location") as HTMLInputElement).value,
		).toBe("/fixture/.jedv/projects"),
	);
	fireEvent.change(f.screen.getByLabelText("Repository URL or path"), {
		target: { value: "https://example.test/repo.git" },
	});
	fireEvent.click(f.screen.getByRole("button", { name: "Clone repository" }));
	await waitFor(() => expect(f.create).toHaveBeenCalledTimes(1));
	fireEvent.click(
		f.screen.getByRole("button", { name: "Request cancellation" }),
	);
	await waitFor(() =>
		expect(
			f.screen.getByText(/confirmed this operation has stopped/),
		).toBeTruthy(),
	);
	expect(f.find).not.toHaveBeenCalled();
	expect(
		f.screen.getByRole("button", { name: "Clone repository" }),
	).toBeTruthy();
	expect(f.create.mock.calls[0]?.[0]).toMatchObject({
		operationId: expect.any(String),
	});
	expect(f.create.mock.calls[0]?.[1]).toMatchObject({
		context: { skipBatch: true },
	});
	f.queries.clear();
});

test("plain folder import never initializes Git and opens only a local workspace", async () => {
	const f = fixture();
	act(() => f.ref.current?.open("folder", "/fixture/plain"));
	fireEvent.change(f.screen.getByLabelText("Project name"), {
		target: { value: "Plain folder" },
	});
	const submit = f.screen.getByRole("button", { name: "Create project" });
	await waitFor(() =>
		expect((submit as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.click(submit);
	await waitFor(() => expect(f.opened).toHaveBeenCalled());
	expect(f.create.mock.calls[0]?.[0]).toMatchObject({
		name: "Plain folder",
		mode: { kind: "folder", repoPath: "/fixture/plain" },
		operationId: expect.any(String),
	});
	expect(f.find).not.toHaveBeenCalled();
	expect(f.workspace.mock.calls[0]?.[0]).toEqual({
		projectId: "project-1",
		checkout: "local",
		runSetup: false,
	});
	expect(f.screen.queryByText("Initialize Git repository?")).toBeNull();
	f.queries.clear();
});
