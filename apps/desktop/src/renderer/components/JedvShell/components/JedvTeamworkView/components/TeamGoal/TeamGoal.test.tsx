import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TeamGoal, truncateGoalPreview } from "./TeamGoal";

afterEach(cleanup);
test("long internal prompts stay collapsed with a 1-line truncated preview and copy preserves the original", async () => {
	const original = `  Task: repair\n${"/private/worktree/long-path ".repeat(80)}`;
	const copy = mock(async (_text: string) => {});
	const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: copy },
	});
	try {
		const screen = render(<TeamGoal name="Repair teamwork" goal={original} />);
		expect(screen.queryByText("Repair teamwork")).toBeNull();
		const preview = screen.getByText(/Task: repair.*…$/);
		expect(preview.textContent?.length).toBeLessThanOrEqual(120);
		expect(preview.textContent).not.toMatch(/\/private\/worktree\/long-pa…$/);
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

test("duplicate header title or empty goal renders nothing", () => {
	const same = render(
		<TeamGoal name="Repair teamwork" goal="  Repair teamwork  " />,
	);
	expect(same.container.firstChild).toBeNull();
	cleanup();
	const empty = render(<TeamGoal name="Repair teamwork" goal="   " />);
	expect(empty.container.firstChild).toBeNull();
});

test("truncateGoalPreview avoids mid-word cuts when whitespace boundaries exist", () => {
	const preview = truncateGoalPreview(
		"Investigate authentication token refresh failure across desktop clients",
		36,
	);
	expect(preview.length).toBeLessThanOrEqual(36);
	expect(preview).toBe("Investigate authentication token…");
});
