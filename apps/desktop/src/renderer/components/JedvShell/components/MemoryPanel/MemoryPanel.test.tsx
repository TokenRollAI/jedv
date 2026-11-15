import { afterEach, expect, mock, test } from "bun:test";
import type { MemoryItemShape } from "@jedv/shared/memory";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	waitFor,
	within,
} from "@testing-library/react";
import type { LocalClient } from "../../local-client";
import { MemoryPanel } from "./MemoryPanel";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
function entry(
	id: string,
	overrides: Partial<MemoryItemShape> = {},
): MemoryItemShape {
	return {
		id,
		scopeKind: "project",
		scopeId: "project",
		title: id,
		content: "Use bounded memory",
		tier: "core",
		category: "convention",
		sourceKind: "human",
		sourceRef: null,
		status: "active",
		supersededById: null,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}
function setup(items: MemoryItemShape[], readOnly = false) {
	const list = mock(async (_input: unknown) => items);
	const search = mock(async (_input: unknown) => items);
	const put = mock(async (_input: unknown) => items[0]);
	const review = mock(async (_input: unknown) => items[0]);
	const remove = mock(async (_input: unknown) => items[0]);
	const client = {
		memory: {
			capabilities: { query: async () => ({ protocolVersion: 1 }) },
			list: { query: list },
			search: { query: search },
			put: { mutate: put },
			reviewCandidate: { mutate: review },
			remove: { mutate: remove },
		},
	} as unknown as LocalClient;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);
	const screen = render(
		<QueryClientProvider client={cache}>
			<MemoryPanel
				client={client}
				hostUrl="http://memory.fixture"
				readOnly={readOnly}
				scopes={[
					{ scopeKind: "project", scopeId: "project", label: "Project" },
					{ scopeKind: "global", scopeId: "", label: "Global" },
				]}
			/>
		</QueryClientProvider>,
	);
	return { screen, list, search, put, review, remove };
}
test("editing supersedes the exact entry in its scope and never sends display labels", async () => {
	const { screen, put } = setup([entry("Original")]);
	fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
	const dialog = screen.getByRole("dialog");
	fireEvent.change(within(dialog).getByRole("textbox", { name: "Title" }), {
		target: { value: "Updated" },
	});
	fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(put).toHaveBeenCalledWith({
			scopeKind: "project",
			scopeId: "project",
			title: "Updated",
			content: "Use bounded memory",
			tier: "core",
			category: "convention",
			sourceKind: "human",
			supersedeId: "Original",
		}),
	);
});
test("global search uses the empty scope ID and filters out results from another scope", async () => {
	const { screen, list, search } = setup([
		entry("Project only"),
		entry("Global only", { scopeKind: "global", scopeId: "" }),
	]);
	await screen.findByText("Project only");
	fireEvent.click(screen.getByRole("combobox", { name: "Memory scope" }));
	fireEvent.click(await screen.findByRole("option", { name: "Global" }));
	await screen.findByText("Global only");
	expect(screen.queryByText("Project only")).toBeNull();
	expect(list).toHaveBeenLastCalledWith({
		scopeKind: "global",
		scopeId: "",
		includeCandidates: true,
		limit: 500,
	});
	fireEvent.change(screen.getByRole("textbox", { name: "Search memory" }), {
		target: { value: "bounded" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Search memory" }));
	await waitFor(() =>
		expect(search).toHaveBeenCalledWith({
			scopeKind: "global",
			scopeId: "",
			query: "bounded",
			limit: 100,
		}),
	);
});
test("candidate acceptance can replace only an active entry in the same scope", async () => {
	const { screen, review } = setup([
		entry("Old"),
		entry("Suggestion", { status: "candidate", sourceKind: "watchdog" }),
		entry("Foreign", { scopeKind: "global", scopeId: "" }),
	]);
	fireEvent.click(
		await screen.findByRole("button", { name: "Accept candidate" }),
	);
	const dialog = screen.getByRole("dialog");
	expect(within(dialog).queryByRole("option", { name: "Foreign" })).toBeNull();
	fireEvent.click(
		within(dialog).getByRole("combobox", {
			name: "Replace an existing memory",
		}),
	);
	expect(screen.queryByRole("option", { name: "Foreign" })).toBeNull();
	fireEvent.click(await screen.findByRole("option", { name: "Old" }));
	fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
	await waitFor(() =>
		expect(review).toHaveBeenCalledWith({
			id: "Suggestion",
			action: "accept",
			supersedeId: "Old",
		}),
	);
});
test("archived team context keeps memory readable and disables all writes across scopes", async () => {
	const { screen, put, review, remove } = setup(
		[entry("Existing"), entry("Suggestion", { status: "candidate" })],
		true,
	);
	await screen.findByText("Existing");
	for (const name of [
		"Add memory",
		"Edit memory",
		"Remove memory",
		"Accept candidate",
		"Reject candidate",
		"Import memory",
	])
		expect(
			(screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
		).toBe(true);
	expect(
		(screen.getByRole("button", { name: "Export memory" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
	fireEvent.click(screen.getByRole("combobox", { name: "Memory scope" }));
	fireEvent.click(await screen.findByRole("option", { name: "Global" }));
	expect(
		(screen.getByRole("button", { name: "Add memory" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(put).not.toHaveBeenCalled();
	expect(review).not.toHaveBeenCalled();
	expect(remove).not.toHaveBeenCalled();
});
test("removal requires confirmation and targets the selected memory ID", async () => {
	const { screen, remove } = setup([entry("Delete me")]);
	fireEvent.click(await screen.findByRole("button", { name: "Remove memory" }));
	expect(remove).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: "Delete me" }));
});
