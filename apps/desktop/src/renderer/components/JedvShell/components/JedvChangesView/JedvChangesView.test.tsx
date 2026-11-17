import { afterEach, expect, mock, test } from "bun:test";
import { TooltipProvider } from "@jedv/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { LocalClient } from "../../local-client";
import { GitChangesView } from "./GitChangesView";
import { JedvChangesView } from "./JedvChangesView";

function createTestIpcClient() {
	return electronTrpc.createClient({
		links: [
			() => () =>
				observable((emit) => {
					emit.next({ result: { data: {} } });
					emit.complete();
				}),
		],
	});
}

afterEach(cleanup);
test("plain folder changes display an empty state without mounting Git controls or querying Git", async () => {
	const git = mock(async () => {
		throw new Error("Git must remain disabled");
	});
	const client = {
		workspace: {
			get: {
				query: async () => ({
					id: "folder",
					worktreePath: "/fixture/plain",
					vcsKind: "none",
					capabilities: { git: false, pullRequests: false, worktrees: false },
				}),
			},
		},
		git: { getStatus: { query: git } },
	} as unknown as LocalClient;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const screen = render(
		<QueryClientProvider client={cache}>
			<JedvChangesView
				client={client}
				hostUrl="http://folder.invalid"
				workspaceId="folder"
				active
				onOpenFile={() => {}}
			/>
		</QueryClientProvider>,
	);
	await screen.findByText(
		"Git features are unavailable here. Terminals and files remain available.",
	);
	expect(git).not.toHaveBeenCalled();
	expect(screen.queryByRole("button", { name: "Commit" })).toBeNull();
	cleanup();
	cache.clear();
});

function createGitClientFixture() {
	const file = {
		path: "src/app.ts",
		status: "modified" as const,
		additions: 2,
		deletions: 1,
		isBinary: false,
	};
	return {
		workspace: {
			get: {
				query: async () => ({
					id: "ws-1",
					worktreePath: "/fixture/repo",
					vcsKind: "git",
					capabilities: { git: true, pullRequests: true, worktrees: true },
				}),
			},
		},
		git: {
			getStatus: {
				query: async () => ({
					currentBranch: {
						name: "feature/test",
						lastCommitHash: "abc1234",
						upstream: "origin/feature/test",
					},
					defaultBranch: { name: "main" },
					staged: [],
					unstaged: [file],
					againstBase: [],
				}),
			},
			getBaseBranch: { query: async () => ({ baseBranch: "main" }) },
			listBranches: {
				query: async () => ({
					branches: [
						{ name: "main", isHead: false },
						{ name: "feature/test", isHead: true },
					],
				}),
			},
			getBranchSyncStatus: {
				query: async () => ({ pushCount: 1, pullCount: 0 }),
			},
			getConflicts: { query: async () => ({ paths: [] }) },
			getPushPreview: {
				query: async () => ({ status: "unsupported", reason: "no-remote" }),
			},
			listCommits: { query: async () => ({ commits: [] }) },
			getDiff: {
				query: async () => ({
					oldFile: { contents: "const a = 1;\n" },
					newFile: { contents: "const a = 2;\n" },
				}),
			},
		},
	} as unknown as LocalClient;
}

test("collapses duplicate Changes heading into a single 36px toolbar and hides header in shipOnly", async () => {
	const client = createGitClientFixture();
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={cache}>
			<TooltipProvider>
				<GitChangesView
					client={client}
					hostUrl="http://repo.invalid"
					workspaceId="ws-1"
					active
					onOpenFile={() => {}}
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);

	await view.findByText("feature/test");
	await view.findByText("No remote configured");
	expect(view.queryByText("no-remote")).toBeNull();
	expect(view.queryByRole("heading", { name: "Changes" })).toBeNull();
	const header = view.container.querySelector("header");
	expect(header).not.toBeNull();
	expect(header?.className).toContain("h-9");
	expect(view.getAllByRole("button", { name: /Push/i })).toHaveLength(1);

	view.rerender(
		<QueryClientProvider client={cache}>
			<TooltipProvider>
				<GitChangesView
					client={client}
					hostUrl="http://repo.invalid"
					workspaceId="ws-1"
					active
					shipOnly="commit"
					onOpenFile={() => {}}
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);
	expect(view.container.querySelector("header")).toBeNull();
	cleanup();
	cache.clear();
});

test("forces inline diff under 560px width, restores side-by-side at >= 560px, and uses single-column back nav under 480px", async () => {
	const observers: Array<{
		callback: ResizeObserverCallback;
		elements: Element[];
	}> = [];
	const OriginalResizeObserver = globalThis.ResizeObserver;
	const OriginalWindowResizeObserver = window.ResizeObserver;
	const happyDomWindow = window as unknown as {
		happyDOM?: { setURL: (url: string) => void };
	};
	const previousHref = window.location.href;
	happyDomWindow.happyDOM?.setURL("http://localhost/");
	const MockResizeObserver = class {
		private callback: ResizeObserverCallback;
		private elements: Element[] = [];
		constructor(callback: ResizeObserverCallback) {
			this.callback = callback;
			observers.push({ callback, elements: this.elements });
		}
		observe(target: Element) {
			this.elements.push(target);
		}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
	globalThis.ResizeObserver = MockResizeObserver;
	window.ResizeObserver = MockResizeObserver;

	try {
		const client = createGitClientFixture();
		const cache = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const ipc = createTestIpcClient();
		const view = render(
			<QueryClientProvider client={cache}>
				<electronTrpc.Provider client={ipc} queryClient={cache}>
					<TooltipProvider>
						<GitChangesView
							client={client}
							hostUrl="http://repo.invalid"
							workspaceId="ws-1"
							active
							onOpenFile={() => {}}
						/>
					</TooltipProvider>
				</electronTrpc.Provider>
			</QueryClientProvider>,
		);

		await view.findByText("feature/test");
		await view.findByText("Unstaged");
		const diffPane = view.container.querySelector(
			"[data-changes-diff-pane]",
		) as HTMLElement;
		const splitLayout = diffPane.parentElement as HTMLElement;
		const scrollContainer = view.container.querySelector(
			"[data-changes-scroll-container]",
		) as HTMLElement;
		Object.defineProperty(scrollContainer, "offsetWidth", {
			configurable: true,
			value: 300,
		});
		Object.defineProperty(scrollContainer, "offsetHeight", {
			configurable: true,
			value: 400,
		});

		// Switch to folder list view mode so ChangedFileRow renders as a regular DOM button
		await act(async () => {
			fireEvent.click(view.getByRole("button", { name: "Folder view" }));
		});
		const fileRow = await view.findByText("app.ts");
		await act(async () => {
			fireEvent.click(fileRow);
		});

		const setWidths = async (layoutW: number, diffW: number) => {
			Object.defineProperty(splitLayout, "clientWidth", {
				configurable: true,
				value: layoutW,
			});
			Object.defineProperty(diffPane, "clientWidth", {
				configurable: true,
				value: diffW,
			});
			await act(async () => {
				for (const obs of observers) {
					obs.callback([], {} as ResizeObserver);
				}
			});
		};

		await setWidths(800, 420);
		const sideBySide = view.getByRole("button", {
			name: "Side by side",
		}) as HTMLButtonElement;
		expect(sideBySide.disabled).toBe(true);

		await setWidths(1000, 620);
		expect(sideBySide.disabled).toBe(false);

		// Under 480px layout width, single-column mode shows Back to changes button
		await setWidths(380, 380);
		const backBtn = view.getByRole("button", { name: "Back to changes" });
		await act(async () => {
			fireEvent.click(backBtn);
		});
		expect(view.queryByRole("button", { name: "Back to changes" })).toBeNull();

		cleanup();
		cache.clear();
	} finally {
		globalThis.ResizeObserver = OriginalResizeObserver;
		window.ResizeObserver = OriginalWindowResizeObserver;
		happyDomWindow.happyDOM?.setURL(previousHref);
	}
});

test("closes open branch dropdown menu when active becomes false", async () => {
	const client = createGitClientFixture();
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const view = render(
		<QueryClientProvider client={cache}>
			<TooltipProvider>
				<GitChangesView
					client={client}
					hostUrl="http://repo.invalid"
					workspaceId="ws-1"
					active
					onOpenFile={() => {}}
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);

	const branchBtn = (await view.findByText("feature/test")).closest(
		"button",
	) as HTMLButtonElement;
	await act(async () => {
		fireEvent.pointerDown(branchBtn, { button: 0, ctrlKey: false });
		fireEvent.click(branchBtn);
	});
	expect(branchBtn.getAttribute("aria-expanded")).toBe("true");

	view.rerender(
		<QueryClientProvider client={cache}>
			<TooltipProvider>
				<GitChangesView
					client={client}
					hostUrl="http://repo.invalid"
					workspaceId="ws-1"
					active={false}
					onOpenFile={() => {}}
				/>
			</TooltipProvider>
		</QueryClientProvider>,
	);
	expect(branchBtn.getAttribute("aria-expanded")).toBe("false");
	cleanup();
	cache.clear();
});
