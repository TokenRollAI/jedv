import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { LocalClient } from "../../../../local-client";
import type { JedvParityViewContext } from "../../../../parity-types";
import { FilesWorkspace } from "./FilesWorkspace";

afterEach(cleanup);

function createTestIpcClient() {
	return electronTrpc.createClient({
		links: [
			() => () =>
				observable((emit) => {
					emit.next({ result: { data: "off" } });
					emit.complete();
				}),
		],
	});
}

function createFilesClientFixture() {
	return {
		workspace: {
			get: {
				query: async () => ({
					id: "ws-files",
					worktreePath: "/fixture/repo",
					vcsKind: "git",
					capabilities: { git: true, pullRequests: true, worktrees: true },
				}),
			},
		},
		filesystem: {
			listDirectory: {
				query: async () => ({
					entries: [
						{
							name: "README.md",
							path: "/fixture/repo/README.md",
							kind: "file",
						},
					],
				}),
			},
			readDirectory: {
				query: async () => ({
					entries: [
						{
							name: "README.md",
							relativePath: "README.md",
							kind: "file",
							size: 8,
						},
					],
				}),
			},
			readFile: {
				query: async () => ({
					kind: "text",
					content: "# Hello\n",
					encoding: "utf8",
					revision: "rev-1",
					sizeBytes: 8,
					binary: false,
				}),
			},
			writeFile: { mutate: async () => ({ revision: "rev-2" }) },
			createDirectory: { mutate: async () => ({}) },
			deletePath: { mutate: async () => ({}) },
			movePath: { mutate: async () => ({}) },
			copyPath: { mutate: async () => ({}) },
			stat: { query: async () => ({ exists: true, kind: "file" }) },
			statPath: {
				mutate: async () => ({
					resolvedPath: "/fixture/repo/README.md",
					exists: true,
					isDirectory: false,
					isFile: true,
					size: 8,
				}),
			},
			getMetadata: { query: async () => ({ kind: "file" }) },
			searchFiles: { query: async () => ({ matches: [] }) },
		},
		git: {
			getStatus: {
				query: async () => ({
					currentBranch: { name: "main", lastCommitHash: "abc" },
					defaultBranch: { name: "main" },
					staged: [],
					unstaged: [],
					againstBase: [],
					ignoredPaths: [],
				}),
			},
		},
	} as unknown as LocalClient;
}

describe("FilesWorkspace", () => {
	test("keeps status badge and Save/External buttons shrink-0 and enforces 180px minimum tree panel width", async () => {
		const observers: Array<{
			callback: ResizeObserverCallback;
			targets: Element[];
		}> = [];
		const OriginalResizeObserver = globalThis.ResizeObserver;
		globalThis.ResizeObserver = class MockResizeObserver {
			private callback: ResizeObserverCallback;
			private targets: Element[] = [];
			constructor(callback: ResizeObserverCallback) {
				this.callback = callback;
				observers.push({ callback, targets: this.targets });
			}
			observe(target: Element) {
				this.targets.push(target);
			}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;

		try {
			const cache = new QueryClient({
				defaultOptions: { queries: { retry: false } },
			});
			const ipc = createTestIpcClient();
			const client = createFilesClientFixture();

			const view = render(
				<QueryClientProvider client={cache}>
					<electronTrpc.Provider client={ipc} queryClient={cache}>
						<FilesWorkspace
							context={
								{
									client,
									hostUrl: "http://files.invalid",
									remote: null,
								} as unknown as JedvParityViewContext
							}
							workspaceId="ws-files"
							initialPath="/fixture/repo/README.md"
							getWsToken={() => null}
							active
						/>
					</electronTrpc.Provider>
				</QueryClientProvider>,
			);

			const savedBadge = await view.findByText("Saved");
			expect(savedBadge.className).toContain("shrink-0");

			const saveBtn = view.getByRole("button", { name: "Save file" });
			const externalBtn = view.getByRole("button", {
				name: "Open in external editor",
			});
			expect(saveBtn.className).toContain("shrink-0");
			expect(externalBtn.className).toContain("shrink-0");

			const handle = view.container.querySelector(
				'[data-slot="resizable-handle"]',
			);
			expect(handle?.className).toContain("hover:bg-primary/40");

			// Simulate a 500px-wide container: tree minSize must scale up to 36% (= 180px)
			const panelGroup = view.container.querySelector(
				'[data-slot="resizable-panel-group"]',
			);
			const groupWrapper = panelGroup?.parentElement as HTMLElement;
			Object.defineProperty(groupWrapper, "clientWidth", {
				configurable: true,
				value: 500,
			});
			act(() => {
				for (const obs of observers) {
					if (obs.targets.includes(groupWrapper)) {
						obs.callback([], {} as ResizeObserver);
					}
				}
			});

			const treePanel = view.container.querySelector(
				'[data-slot="resizable-panel"]',
			) as HTMLElement;
			expect(treePanel.style.minWidth).toBe("180px");
			// Wait for imperative panel.resize(36) if react-resizable-panels flushes async
			expect(
				Number.parseFloat(treePanel.style.flexGrow),
			).toBeGreaterThanOrEqual(24);

			cleanup();
			cache.clear();
		} finally {
			globalThis.ResizeObserver = OriginalResizeObserver;
		}
	});
});
