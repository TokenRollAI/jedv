import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ActiveBinding } from "../../../ActiveWorkspaceSwitcher/active-workspaces";
import { WorkspaceAgentsChip } from "./WorkspaceAgentsChip";

afterEach(cleanup);

const bindings: ActiveBinding[] = Array.from({ length: 8 }, (_, index) => ({
	terminalId: `terminal-${index}`,
	workspaceId: "workspace",
	agentId: "codex",
	lastEventType: "Start",
	startedAt: index,
	lastEventAt: index,
}));

test("a single agent adds no redundant sidebar row", () => {
	const screen = render(
		<WorkspaceAgentsChip bindings={bindings.slice(0, 1)} onOpen={() => {}} />,
	);
	expect(screen.queryByRole("button")).toBeNull();
});

test("a lone agent with subagents retains its activity chip", async () => {
	const binding = bindings[0];
	if (!binding) throw new Error("Missing binding");
	const screen = render(
		<WorkspaceAgentsChip
			bindings={[
				{
					...binding,
					subagents: [
						{ id: "child", agentType: "Explore", startedAt: 1, lastEventAt: 1 },
					],
				},
			]}
			onOpen={() => {}}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Agents: 1 +1" }));
	expect(await screen.findByText("Explore")).toBeTruthy();
});

test("many sessions stay behind one chip and selection opens the exact terminal", async () => {
	const open = mock((_id: string) => {});
	const screen = render(
		<WorkspaceAgentsChip bindings={bindings} onOpen={open} />,
	);
	const chip = screen.getByRole("button", { name: "Agents: 8" });
	expect(screen.queryByRole("button", { name: /Open .* session/ })).toBeNull();
	fireEvent.click(chip);
	const sessions = await screen.findAllByRole("button", {
		name: /Open .* session/,
	});
	expect(sessions).toHaveLength(8);
	const target = sessions[3];
	if (!target) throw new Error("Missing session row");
	fireEvent.click(target);
	expect(open).toHaveBeenCalledWith("terminal-3");
	await waitFor(() => expect(chip.getAttribute("aria-expanded")).toBe("false"));
});

test("click toggles the card and Escape closes it without selecting a session", async () => {
	const open = mock((_id: string) => {});
	const screen = render(
		<WorkspaceAgentsChip bindings={bindings} onOpen={open} />,
	);
	const chip = screen.getByRole("button", { name: "Agents: 8" });
	fireEvent.click(chip);
	expect(chip.getAttribute("aria-expanded")).toBe("true");
	fireEvent.click(chip);
	expect(chip.getAttribute("aria-expanded")).toBe("false");
	fireEvent.click(chip);
	fireEvent.keyDown(chip, { key: "Escape" });
	expect(chip.getAttribute("aria-expanded")).toBe("false");
	expect(open).not.toHaveBeenCalled();
});
