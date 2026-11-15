import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PresetEditor } from "./PresetEditor";

afterEach(cleanup);

test("a missing association blocks save while unlinking restores an editable preset", () => {
	const preset = {
		id: "preset",
		name: "Fixture",
		cwd: "",
		commands: ["echo fixture"],
		agentId: "00000000-0000-4000-8000-000000000001",
	};
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const screen = render(
		<QueryClientProvider client={queryClient}>
			<PresetEditor
				preset={preset}
				projects={[]}
				agents={[]}
				agentsPending={false}
				loadAgents={async () => []}
				readPresets={async () => [preset]}
				onSaved={async () => {}}
				onCancel={() => {}}
			/>
		</QueryClientProvider>,
	);
	expect(screen.getByRole("alert").textContent).toContain(
		"Linked agent is unavailable.",
	);
	expect(
		(screen.getByRole("button", { name: "Save preset" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Remove agent link" }));
	expect(screen.queryByRole("alert")).toBeNull();
	expect(
		(screen.getByRole("button", { name: "Save preset" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
	expect(
		(screen.getByRole("textbox", { name: "Command 1" }) as HTMLTextAreaElement)
			.disabled,
	).toBe(false);
	queryClient.clear();
});
