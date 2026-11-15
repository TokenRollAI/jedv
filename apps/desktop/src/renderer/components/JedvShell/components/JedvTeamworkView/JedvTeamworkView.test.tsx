import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { useTeamwork } from "../../hooks/useTeamwork";
import type { JedvParityViewContext } from "../../parity-types";
import { JedvTeamworkView } from "./JedvTeamworkView";
import { teamMailDrafts } from "./team-mail-drafts";

const caches: QueryClient[] = [];
afterEach(async () => {
	await act(async () => {
		cleanup();
		teamMailDrafts.clear();
		for (const cache of caches.splice(0)) cache.clear();
	});
});

type Failure = "offline" | "list" | "capabilities";
function fixture() {
	const send = mock(async (_input: unknown): Promise<unknown> => {
		throw new Error("Transport lost after send");
	});
	const stop = mock(async (_input: unknown) => {});
	const team = {
		id: "team-a",
		name: "Team A",
		goal: "",
		status: "active",
	};
	const context = {
		hostUrl: "http://host-a.fixture",
		projects: [],
		workspaces: [],
		client: {
			team: {
				stop: { mutate: stop },
				status: {
					query: async ({ teamId }: { teamId: string }) => ({
						team: { ...team, id: teamId },
						members: [
							{
								id: "leader-id",
								teamId,
								name: "leader",
								role: "leader",
								status: "active",
								agentId: "codex",
								taskSummary: "",
								joinedAt: 1,
								binding: null,
								deliveryState: "idle",
							},
						],
					}),
				},
			},
			mail: { timeline: { query: async () => [] }, send: { mutate: send } },
			declarativeSlots: {
				capabilities: { query: async () => ({ protocolVersion: 1 }) },
				resolveView: { query: async () => [] },
			},
		},
	} as unknown as JedvParityViewContext;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);
	const providers = new Map([["initial", cache]]);
	const ipc = electronTrpc.createClient({
		links: [
			() => () =>
				observable((emit) => {
					emit.next({ result: { data: 1 } });
					emit.complete();
				}),
		],
	});
	function tree({
		failure,
		hostUrl = context.hostUrl,
		teamId = team.id,
		logicalHostId,
		generation = "initial",
		absent = false,
		recovering = false,
		sendMessage = send,
	}: {
		failure?: Failure;
		hostUrl?: string;
		teamId?: string;
		logicalHostId?: string;
		generation?: string;
		absent?: boolean;
		recovering?: boolean;
		sendMessage?: typeof send;
	} = {}) {
		let provider = providers.get(generation);
		if (!provider) {
			provider = new QueryClient({
				defaultOptions: { queries: { retry: false } },
			});
			providers.set(generation, provider);
			caches.push(provider);
		}
		const index = {
			list: {
				data: recovering ? undefined : [{ ...team, id: teamId }],
				isError: failure === "list",
				isPending: recovering,
			},
			supported: !recovering && failure !== "capabilities",
			capabilities: {
				data: recovering ? undefined : { protocolVersion: 1 },
				isError: failure === "capabilities",
				isSuccess: !recovering && failure !== "capabilities",
				isPending: recovering,
			},
		} as unknown as ReturnType<typeof useTeamwork>;
		return (
			<QueryClientProvider key={generation} client={provider}>
				<electronTrpc.Provider client={ipc} queryClient={provider}>
					{!absent && (
						<JedvTeamworkView
							key={hostUrl}
							context={{
								...context,
								hostUrl,
								logicalHostId,
								client: {
									...context.client,
									mail: {
										...context.client.mail,
										send: { mutate: sendMessage },
									},
								} as JedvParityViewContext["client"],
							}}
							index={index}
							connected={failure !== "offline"}
							selectedId={teamId}
							onCreate={() => {}}
						/>
					)}
				</electronTrpc.Provider>
			</QueryClientProvider>
		);
	}
	const screen = render(tree());
	return { screen, send, stop, tree };
}

for (const failure of ["offline", "list", "capabilities"] as const) {
	test(`Team Mail preserves its uncertain request through a transient ${failure} failure`, async () => {
		const { screen, send, tree } = fixture();
		const input = (await screen.findByRole("textbox", {
			name: "Message to team",
		})) as HTMLTextAreaElement;
		await waitFor(() => expect(input.disabled).toBe(false));
		fireEvent.click(screen.getByRole("combobox", { name: "Mail recipient" }));
		fireEvent.click(await screen.findByRole("option", { name: "leader" }));
		const body = "  原始指令\n    保留缩进  ";
		fireEvent.change(input, { target: { value: body } });
		expect(
			(screen.getByRole("button", { name: "Send mail" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
		await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(input.disabled).toBe(false));
		const original = send.mock.calls[0]?.[0];
		screen.rerender(tree({ failure }));
		expect(input.isConnected).toBe(true);
		expect(input.value).toBe(body);
		expect(input.disabled).toBe(true);
		const form = input.closest("form");
		if (!form) throw new Error("Missing Team Mail form");
		fireEvent.submit(form);
		expect(send).toHaveBeenCalledTimes(1);
		screen.rerender(tree());
		await waitFor(() => expect(input.disabled).toBe(false));
		expect(screen.getByRole("textbox", { name: "Message to team" })).toBe(
			input,
		);
		expect(input.value).toBe(body);
		fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
		await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		expect(send.mock.calls[1]?.[0]).toEqual(original);
		expect(original).toMatchObject({
			teamId: "team-a",
			to: "leader",
			body,
			dedupeKey: expect.any(String),
		});
	});
}

test("an unsent Team Mail draft survives offline recovery and stays isolated by Host and Team", async () => {
	const { screen, tree } = fixture();
	const input = (await screen.findByRole("textbox", {
		name: "Message to team",
	})) as HTMLTextAreaElement;
	await waitFor(() => expect(input.disabled).toBe(false));
	fireEvent.change(input, { target: { value: "Host A / Team A draft" } });
	screen.rerender(tree({ failure: "offline" }));
	screen.rerender(tree());
	expect(screen.getByRole("textbox", { name: "Message to team" })).toBe(input);
	expect(input.value).toBe("Host A / Team A draft");
	screen.rerender(tree({ teamId: "team-b" }));
	const teamB = (await screen.findByRole("textbox", {
		name: "Message to team",
	})) as HTMLTextAreaElement;
	await waitFor(() => expect(teamB.disabled).toBe(false));
	expect(teamB).not.toBe(input);
	expect(teamB.value).toBe("");
	fireEvent.change(teamB, { target: { value: "Host A / Team B draft" } });
	screen.rerender(tree({ teamId: "team-b", hostUrl: "http://host-b.fixture" }));
	const hostB = (await screen.findByRole("textbox", {
		name: "Message to team",
	})) as HTMLTextAreaElement;
	await waitFor(() => expect(hostB.disabled).toBe(false));
	expect(hostB).not.toBe(teamB);
	expect(hostB.value).toBe("");
});

test("a confirmation opened before disconnect cannot submit a Team action while offline", async () => {
	const { screen, stop, tree } = fixture();
	await screen.findByRole("button", { name: "Pause automatic wake-ups" });
	const menu = screen.getAllByRole("button", { name: "More options" })[0];
	if (!menu) throw new Error("Missing Team menu");
	fireEvent.keyDown(menu, {
		key: "Enter",
	});
	fireEvent.click(await screen.findByRole("menuitem", { name: "Stop team" }));
	const dialog = await screen.findByRole("alertdialog");
	screen.rerender(tree({ failure: "offline" }));
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await within(dialog).findByText(
		"Some team data could not be loaded. Check the host connection and retry.",
	);
	expect(stop).not.toHaveBeenCalled();
});

test("a Host restart preserves unsent Mail through the Shell endpoint key, missing context and fresh providers", async () => {
	const { screen, tree } = fixture();
	const rerender = async (...args: Parameters<typeof tree>) => {
		await act(async () => screen.rerender(tree(...args)));
	};
	const logicalHostId = "local:jedv-local";
	await rerender({ logicalHostId, hostUrl: "http://127.0.0.1:41001" });
	const before = (await screen.findByRole("textbox", {
		name: "Message to team",
	})) as HTMLTextAreaElement;
	const body = "断线恢复验收草稿：请保留，不发送。";
	fireEvent.change(before, { target: { value: body } });
	// Shell loses viewContext while the child is gone, then receives a new endpoint/client.
	await rerender({ absent: true, generation: "child-exited" });
	expect(before.isConnected).toBe(false);
	await rerender({
		logicalHostId,
		hostUrl: "http://127.0.0.1:42002",
		generation: "new-client-provider",
		recovering: true,
	});
	expect(screen.queryByRole("textbox", { name: "Message to team" })).toBeNull();
	await rerender({
		logicalHostId,
		hostUrl: "http://127.0.0.1:42002",
		generation: "new-client-provider",
	});
	const after = (await screen.findByRole("textbox", {
		name: "Message to team",
	})) as HTMLTextAreaElement;
	expect(after).not.toBe(before);
	expect(after.value).toBe(body);
	await waitFor(() =>
		expect(
			(screen.getByRole("button", { name: "Send mail" }) as HTMLButtonElement)
				.disabled,
		).toBe(false),
	);
	await rerender({
		logicalHostId: "private:https://other.ts.net",
		hostUrl: "https://other.ts.net",
		generation: "other-host",
	});
	expect(
		(await screen.findByRole("textbox", {
			name: "Message to team",
		})) as HTMLTextAreaElement,
	).toHaveProperty("value", "");
	await rerender({
		logicalHostId,
		hostUrl: "http://127.0.0.1:42002",
		generation: "local-again",
	});
	expect(
		(await screen.findByRole("textbox", {
			name: "Message to team",
		})) as HTMLTextAreaElement,
	).toHaveProperty("value", body);
});

test("an old in-flight rejection keeps its exact dedupe for the new Host client after provider remount", async () => {
	const { screen, send, tree } = fixture();
	const rerender = async (...args: Parameters<typeof tree>) => {
		await act(async () => screen.rerender(tree(...args)));
	};
	const logicalHostId = "local:jedv-local";
	let rejectOld = (_cause: Error) => {};
	send.mockImplementationOnce(
		() =>
			new Promise((_resolve, reject) => {
				rejectOld = reject;
			}),
	);
	await rerender({ logicalHostId, hostUrl: "http://127.0.0.1:41001" });
	const input = (await screen.findByRole("textbox", {
		name: "Message to team",
	})) as HTMLTextAreaElement;
	await waitFor(() => expect(input.disabled).toBe(false));
	const body = "  uncertain\n    保留原键  ";
	fireEvent.change(input, { target: { value: body } });
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
	const original = send.mock.calls[0]?.[0];
	await rerender({ absent: true });
	const retry = mock(async (_input: unknown): Promise<unknown> => ({}));
	const recovered = {
		logicalHostId,
		hostUrl: "http://127.0.0.1:42002",
		generation: "recreated-provider",
		sendMessage: retry,
	};
	await rerender(recovered);
	const restored = (await screen.findByRole("textbox", {
		name: "Message to team",
	})) as HTMLTextAreaElement;
	expect(restored.value).toBe(body);
	expect(restored.disabled).toBe(true);
	await act(async () => rejectOld(new Error("original connection closed")));
	await waitFor(() => expect(restored.disabled).toBe(false));
	expect(restored.value).toBe(body);
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
	expect(retry.mock.calls[0]?.[0]).toEqual(original);
	await waitFor(() => expect(restored.value).toBe(""));
	expect(
		teamMailDrafts.read({ hostId: logicalHostId, teamId: "team-a" }).request,
	).toBeNull();
});
