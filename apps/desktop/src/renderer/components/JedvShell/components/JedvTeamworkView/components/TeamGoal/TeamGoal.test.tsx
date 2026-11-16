import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TeamGoal } from "./TeamGoal";

afterEach(cleanup);
test("long internal prompts stay collapsed and copy preserves the original", async () => {
	const original = `  Task: repair\n${"/private/worktree/long-path ".repeat(80)}`;
	const copy = mock(async (_text: string) => {});
	const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: copy },
	});
	try {
		const screen = render(<TeamGoal name="Repair teamwork" goal={original} />);
		expect(screen.getByText("Repair teamwork")).toBeTruthy();
		const disclosure = screen
			.getByText("Full task instructions")
			.closest("details");
		expect(disclosure?.open).toBe(false);
		fireEvent.click(screen.getByText("Full task instructions"));
		expect(disclosure?.open).toBe(true);
		expect(disclosure?.querySelector("pre")?.textContent).toBe(original);
		fireEvent.click(
			screen.getByRole("button", { name: "Copy original instructions" }),
		);
		await waitFor(() => expect(copy).toHaveBeenCalledWith(original));
	} finally {
		if (previous) Object.defineProperty(navigator, "clipboard", previous);
		else Reflect.deleteProperty(navigator, "clipboard");
	}
});
