import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { JedvParityViewContext } from "../../parity-types";
import { DeclarativeDataSlots } from "./DeclarativeDataSlots";

const caches: QueryClient[] = [];
afterEach(() => {
	cleanup();
	for (const cache of caches.splice(0)) cache.clear();
});
function setup(views: unknown[], supported = true) {
	const resolveView = mock(async (_input: unknown) => views);
	const context = {
		hostUrl: "http://slots.fixture",
		client: {
			declarativeSlots: {
				capabilities: {
					query: async () => ({ protocolVersion: supported ? 1 : 0 }),
				},
				resolveView: { query: resolveView },
			},
		},
	} as unknown as JedvParityViewContext;
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	caches.push(cache);
	const screen = render(
		<QueryClientProvider client={cache}>
			<DeclarativeDataSlots
				context={context}
				surface="sidebar.panel"
				teamId="team"
				connected
			/>
		</QueryClientProvider>,
	);
	return { screen, resolveView, cache };
}
test("declarative slots render plain returned data and never executable markup or an unsafe link", async () => {
	const { screen, resolveView } = setup([
		{
			extensionId: "ci",
			name: "CI",
			target: "sidebar.panel",
			title: "Build",
			cardType: "summary",
			items: [{ label: "State", text: "<script>alert(1)</script>" }],
			url: "javascript:alert(1)",
		},
	]);
	await screen.findByText("<script>alert(1)</script>");
	expect(resolveView).toHaveBeenCalledWith({
		surface: "sidebar.panel",
		teamId: "team",
	});
	expect(screen.container.querySelector("script")).toBeNull();
	expect(screen.queryByRole("button", { name: "Open link" })).toBeNull();
});
test("an empty installed view adds no slot heading or placeholder", async () => {
	const { screen, resolveView } = setup([]);
	await waitFor(() => expect(resolveView).toHaveBeenCalledTimes(1));
	expect(screen.container.children).toHaveLength(0);
});
test("unsupported hosts never query slot data", async () => {
	const { screen, resolveView, cache } = setup([], false);
	await waitFor(() =>
		expect(
			cache.getQueryData([
				"jedv",
				"http://slots.fixture",
				"declarativeSlots",
				"capabilities",
			]),
		).toEqual({ protocolVersion: 0 }),
	);
	expect(resolveView).not.toHaveBeenCalled();
	expect(screen.container.children).toHaveLength(0);
});
