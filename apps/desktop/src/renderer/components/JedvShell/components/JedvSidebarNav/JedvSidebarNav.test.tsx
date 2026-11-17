import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { JedvSidebarNav } from "./JedvSidebarNav";

afterEach(cleanup);

test("sidebar nav removes create-team verb from top nav and triggers settings", () => {
	const onSelect = mock(() => {});
	const view = render(
		<JedvSidebarNav
			surface="terminal"
			usageVisible={false}
			onSelect={onSelect}
			onSearch={() => {}}
			onNewWorkspace={() => {}}
			canCreateWorkspace
		/>,
	);
	expect(view.queryByRole("button", { name: "Create team" })).toBeNull();
	expect(view.getByRole("button", { name: "Workspaces" })).toBeTruthy();
	expect(view.getByRole("button", { name: "Automations" })).toBeTruthy();
	expect(view.getByRole("button", { name: "Pull Requests" })).toBeTruthy();
	fireEvent.click(view.getByRole("button", { name: "Settings" }));
	expect(onSelect).toHaveBeenCalledWith("settings");
});
