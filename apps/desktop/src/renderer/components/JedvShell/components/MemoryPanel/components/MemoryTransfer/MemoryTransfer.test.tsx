import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { LocalClient } from "../../../../local-client";
import { MemoryTransfer } from "./MemoryTransfer";

afterEach(cleanup);
test("JSON import validates before writing and confirms the exact destination scope", async () => {
	const write = mock(async (_input: unknown) => []);
	const changed = mock(async () => {});
	const client = {
		memory: { importData: { mutate: write } },
	} as unknown as LocalClient;
	const screen = render(
		<MemoryTransfer
			client={client}
			hostUrl="http://fixture"
			scope={{ scopeKind: "global", scopeId: "", label: "Global" }}
			disabled={false}
			canExport
			onChanged={changed}
		/>,
	);
	const input = screen.getByLabelText("Import JSON file");
	fireEvent.change(input, {
		target: { files: [new File(["bad"], "invalid.json")] },
	});
	await screen.findByText("Invalid memory JSON");
	expect(write).not.toHaveBeenCalled();
	const data = {
		version: 1,
		entries: [
			{
				title: "Rule",
				content: "Keep scopes separate",
				tier: "core",
				category: "convention",
				sourceKind: "human",
			},
		],
	};
	fireEvent.change(input, {
		target: { files: [new File([JSON.stringify(data)], "memory.json")] },
	});
	await screen.findByRole("alertdialog");
	expect(write).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() =>
		expect(write).toHaveBeenCalledWith({
			scope: { scopeKind: "global", scopeId: "" },
			data,
		}),
	);
	expect(changed).toHaveBeenCalledTimes(1);
});
test("project file import sends a path on the selected host, without changing scope", async () => {
	const write = mock(async (_input: unknown) => []);
	const client = {
		memory: { importProject: { mutate: write } },
	} as unknown as LocalClient;
	const screen = render(
		<MemoryTransfer
			client={client}
			hostUrl="http://fixture"
			scope={{ scopeKind: "project", scopeId: "project-b", label: "Project B" }}
			disabled={false}
			canExport
			onChanged={async () => {}}
		/>,
	);
	fireEvent.keyDown(screen.getByRole("button", { name: "Import memory" }), {
		key: "ArrowDown",
	});
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Import from host file" }),
	);
	const input = await screen.findByRole("textbox", {
		name: "File path on target host",
	});
	fireEvent.change(input, { target: { value: ".jedv/other-memory.json" } });
	fireEvent.click(screen.getByRole("button", { name: "Import" }));
	await waitFor(() =>
		expect(write).toHaveBeenCalledWith({
			projectId: "project-b",
			filePath: ".jedv/other-memory.json",
		}),
	);
});
