import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Project } from "../../types";
import { JedvProjectRow } from "./JedvProjectRow";

afterEach(cleanup);
const project = {
	id: "project-1",
	name: "中文项目",
	icon: "data:image/png;base64,fixture",
	color: "#3b82f6",
} as Project;
function fixture(rename = async (_name: string) => {}) {
	const onRename = mock(rename);
	const screen = render(
		<JedvProjectRow
			project={project}
			collapsed={false}
			onToggle={() => {}}
			onNew={() => {}}
			onCheckout={() => {}}
			onRename={onRename}
			onCopy={() => {}}
			onRemove={() => {}}
		/>,
	);
	return { screen, onRename };
}
test("project row uses the stored icon and Escape cancels rename without a write", () => {
	const f = fixture();
	expect(f.screen.getByRole("img").getAttribute("src")).toBe(project.icon);
	fireEvent.doubleClick(f.screen.getByText(project.name));
	fireEvent.change(f.screen.getByLabelText("Project name"), {
		target: { value: "新的项目名称" },
	});
	fireEvent.keyDown(f.screen.getByLabelText("Project name"), { key: "Escape" });
	expect(f.onRename).not.toHaveBeenCalled();
	expect(f.screen.queryByLabelText("Project name")).toBeNull();
});
test("rename on blur follows the original row behavior and keeps the draft on failure", async () => {
	const f = fixture(async () => {
		throw new Error("offline");
	});
	fireEvent.doubleClick(f.screen.getByText(project.name));
	fireEvent.change(f.screen.getByLabelText("Project name"), {
		target: { value: "新的项目名称" },
	});
	fireEvent.blur(f.screen.getByLabelText("Project name"));
	await waitFor(() => expect(f.screen.getByRole("alert")).toBeTruthy());
	expect(f.onRename).toHaveBeenCalledWith("新的项目名称");
	expect(
		(f.screen.getByLabelText("Project name") as HTMLInputElement).value,
	).toBe("新的项目名称");
});

test("IME Enter does not submit a project rename", () => {
	const f = fixture();
	fireEvent.doubleClick(f.screen.getByText(project.name));
	fireEvent.change(f.screen.getByLabelText("Project name"), {
		target: { value: "输入法候选" },
	});
	fireEvent.keyDown(f.screen.getByLabelText("Project name"), {
		key: "Enter",
		isComposing: true,
		keyCode: 229,
	});
	expect(f.onRename).not.toHaveBeenCalled();
});
