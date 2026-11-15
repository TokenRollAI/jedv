import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { LocalClient } from "../../../../local-client";
import { useProjectRun } from "./useProjectRun";

afterEach(cleanup);
test("Run reuses its terminal, locks duplicate launches and ignores completion after a workspace switch", async () => {
	let complete: (value: { terminalId: string }) => void = () => {};
	let id = "";
	const launch = mock((input: { terminalId: string }) => {
		id = input.terminalId;
		return new Promise<{ terminalId: string }>((resolve) => {
			complete = resolve;
		});
	});
	const openA = mock(async () => {}),
		openB = mock(async () => {});
	const client = {
		config: {
			getWorkspaceRunDefinition: {
				query: async () => ({ commands: ["fixture command"], cwd: "/fixture" }),
			},
		},
		terminal: {
			list: {
				query: async () => ({
					sessions: id ? [{ terminalId: id, exited: false }] : [],
				}),
			},
			hasRunningProcess: { query: async () => ({ running: true }) },
			launchSession: { mutate: launch },
			rename: { mutate: async () => ({}) },
		},
	} as unknown as LocalClient;
	const queries = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queries}>{children}</QueryClientProvider>
	);
	const hook = renderHook(
		({ workspaceId }) =>
			useProjectRun({
				client,
				hostUrl: "http://run-fixture",
				workspaceId,
				projectId: "p",
				onTerminal: workspaceId === "a" ? openA : openB,
				onConfigure: () => {},
			}),
		{ wrapper, initialProps: { workspaceId: "a" } },
	);
	await waitFor(() =>
		expect(hook.result.current.definition.isSuccess).toBe(true),
	);
	let first: Promise<void> = Promise.resolve();
	await act(async () => {
		first = hook.result.current.execute("run");
		await Promise.resolve();
		await hook.result.current.execute("run");
	});
	expect(launch).toHaveBeenCalledTimes(1);
	hook.rerender({ workspaceId: "b" });
	await act(async () => {
		complete({ terminalId: id });
		await first;
	});
	expect(openA).not.toHaveBeenCalled();
	expect(openB).not.toHaveBeenCalled();
	hook.rerender({ workspaceId: "a" });
	await waitFor(() =>
		expect(hook.result.current.status.data?.running).toBe(true),
	);
	await act(async () => {
		await hook.result.current.execute("run");
	});
	expect(launch).toHaveBeenCalledTimes(1);
	expect(openA).toHaveBeenCalledWith(id);
	hook.unmount();
	queries.clear();
});
