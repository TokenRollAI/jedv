import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import type { LocalClient } from "../../local-client";
import { JedvSettingsView } from "./JedvSettingsView";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});

function renderSettings(initialSection?: "general" | "terminal" | "files") {
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);
	const ipc = electronTrpc.createClient({
		links: [
			() => () =>
				observable((emit) => {
					emit.next({ result: { data: null } });
					emit.complete();
				}),
		],
	});
	const client = {
		terminalDaemon: { status: { query: async () => ({ running: false }) } },
		terminal: { list: { query: async () => ({ sessions: [] }) } },
		terminalPresets: { list: { query: async () => [] } },
	} as unknown as LocalClient;
	return render(
		<QueryClientProvider client={cache}>
			<electronTrpc.Provider client={ipc} queryClient={cache}>
				<JedvSettingsView
					client={client}
					hostUrl="http://settings.fixture"
					remote={null}
					projects={[]}
					workspaces={[]}
					initialSection={initialSection}
					onOpenWorkspace={async () => {}}
					onOpenCreateWorkspace={() => {}}
					onOpenPrivateConnection={() => {}}
					onSelectLocalHost={async () => {}}
				/>
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
}

test("defaults to General at the top of navigation and renders zero-match search state only in main pane", () => {
	const screen = renderSettings();
	const navButtons = screen
		.getByRole("navigation", { name: "Settings sections" })
		.querySelectorAll("button");
	expect(navButtons[0]?.textContent).toContain("General");

	const main = screen.getByRole("main");
	expect(main.getAttribute("data-settings-section")).toBe("general");

	const search = screen.getByLabelText("Search settings");
	fireEvent.change(search, { target: { value: "zzzz-no-match" } });

	const noMatchNodes = screen.getAllByText("No matching settings.");
	expect(noMatchNodes).toHaveLength(1);
	const firstNoMatch = noMatchNodes[0];
	expect(firstNoMatch).toBeTruthy();
	expect(firstNoMatch ? main.contains(firstNoMatch) : false).toBe(true);

	const clearButton = within(main).getByRole("button", {
		name: "Clear search",
	});
	expect(main.contains(clearButton)).toBe(true);
	fireEvent.click(clearButton);

	expect(screen.queryByText("No matching settings.")).toBeNull();
	expect((search as HTMLInputElement).value).toBe("");
});

test("terminal section jumps to Files & editor for link behavior instead of duplicating dropdowns", () => {
	const screen = renderSettings("terminal");
	expect(screen.queryByText("URL links")).toBeNull();
	const jump = screen.getByRole("button", {
		name: "Configure in Files & editor",
	});
	fireEvent.click(jump);
	expect(screen.getByRole("main").getAttribute("data-settings-section")).toBe(
		"files",
	);
	expect(screen.getByText("URL links")).toBeTruthy();
});
