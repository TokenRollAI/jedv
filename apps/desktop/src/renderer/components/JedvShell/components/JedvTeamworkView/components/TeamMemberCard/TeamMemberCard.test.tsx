import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { TeamMember } from "../../../../hooks/useTeamwork";
import { TeamMemberCard } from "./TeamMemberCard";

afterEach(cleanup);
test("long member instructions have a short hover preview and explicit full-text disclosure", () => {
	const original = `Inspect teamwork\n\n${"/tmp/fixture/long/path ".repeat(100)}`;
	const member = {
		id: "member",
		name: "leader",
		agentId: "fixture",
		role: "leader",
		status: "active",
		taskSummary: original,
		deliveryState: "idle",
		binding: null,
	} as TeamMember;
	const screen = render(
		<TeamMemberCard
			member={member}
			live={false}
			pending={false}
			onOpen={() => {}}
		/>,
	);
	const summary = screen.getByLabelText("Full task instructions");
	expect(summary.getAttribute("title")).toBe("Inspect teamwork");
	expect(summary.textContent).toBe("Inspect teamwork");
	expect(summary.closest("details")?.open).toBe(false);
	fireEvent.click(summary);
	expect(summary.closest("details")?.open).toBe(true);
	expect(summary.closest("details")?.querySelector("pre")?.textContent).toBe(
		original,
	);
});
