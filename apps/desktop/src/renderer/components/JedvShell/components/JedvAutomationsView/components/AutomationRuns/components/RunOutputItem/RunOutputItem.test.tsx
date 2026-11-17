import { afterEach, expect, mock, test } from "bun:test";
import type { ApprovalRequest } from "@jedv/chat/protocol";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { RunOutputItem } from "./RunOutputItem";

afterEach(cleanup);
test("the themed approval pickers preserve false, nullable and multi-choice values", async () => {
	const approve = mock(() => {});
	const item: ApprovalRequest = {
		id: "form",
		startedAtMs: 1,
		kind: "approval_request",
		targetItemId: null,
		title: "Approval",
		status: "pending",
		form: {
			message: "Configure",
			fields: [
				{
					id: "permission",
					title: "Permission",
					input: "boolean",
					required: true,
				},
				{
					id: "target",
					title: "Target",
					input: "single",
					options: [{ value: "one", label: "One" }],
				},
				{
					id: "files",
					title: "Files",
					input: "multi",
					required: true,
					options: [
						{ value: "a", label: "A" },
						{ value: "b", label: "B" },
					],
				},
			],
		},
	};
	const screen = render(
		<RunOutputItem
			item={item}
			pending={false}
			canControl
			onApprove={approve}
		/>,
	);
	const submit = screen.getByRole("button", { name: "Submit response" });
	expect((submit as HTMLButtonElement).disabled).toBe(true);
	fireEvent.click(screen.getByRole("combobox", { name: "Files" }));
	fireEvent.click(await screen.findByRole("option", { name: "A" }));
	fireEvent.click(screen.getByRole("option", { name: "B" }));
	fireEvent.click(screen.getByRole("option", { name: "A" }));
	fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
	fireEvent.click(screen.getByRole("combobox", { name: "Permission" }));
	fireEvent.click(await screen.findByRole("option", { name: "No" }));
	fireEvent.click(screen.getByRole("combobox", { name: "Target" }));
	fireEvent.click(await screen.findByRole("option", { name: "One" }));
	fireEvent.click(screen.getByRole("combobox", { name: "Target" }));
	fireEvent.click(
		await screen.findByRole("option", { name: "Select an option" }),
	);
	await waitFor(() =>
		expect((submit as HTMLButtonElement).disabled).toBe(false),
	);
	fireEvent.click(submit);
	expect(approve).toHaveBeenCalledWith({
		type: "form",
		values: { permission: "false", target: "", files: ["b"] },
	});
});

test("approval option buttons map standard English ACP labels and preserve custom labels", () => {
	const approve = mock(() => {});
	const item: ApprovalRequest = {
		id: "opts",
		startedAtMs: 1,
		kind: "approval_request",
		targetItemId: null,
		title: "Run command",
		status: "pending",
		options: [
			{ optionId: "allow", label: "Allow", kind: "allow_once" },
			{ optionId: "allow-once", label: "Allow once", kind: "allow_once" },
			{ optionId: "deny", label: "Deny", kind: "reject_once" },
			{ optionId: "reject", label: "Reject", kind: "reject_once" },
			{ optionId: "custom", label: "Custom action", kind: "allow_once" },
		],
	};
	const screen = render(
		<RunOutputItem
			item={item}
			pending={false}
			canControl
			onApprove={approve}
		/>,
	);
	for (const label of [
		"Allow",
		"Allow once",
		"Deny",
		"Reject",
		"Custom action",
	]) {
		expect(screen.getByRole("button", { name: label })).toBeTruthy();
	}
	fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
	expect(approve).toHaveBeenCalledWith({
		type: "option",
		optionId: "allow-once",
	});
});
