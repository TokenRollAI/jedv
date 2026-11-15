import { afterEach, expect, mock, test } from "bun:test";
import type { ButlerApprovalShape } from "@jedv/shared/butler";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Team } from "../../../../hooks/useTeamwork";
import { ButlerApprovalCard } from "./ButlerApprovalCard";

afterEach(cleanup);
const approval = (
	status: ButlerApprovalShape["status"],
	past = true,
): ButlerApprovalShape => ({
	id: "approval-uuid",
	threadId: "thread",
	actionType: "stopTeam",
	targetId: "team-uuid",
	summary: "Stop Team team-uuid",
	payload: { actionType: "stopTeam", teamId: "team-uuid" },
	payloadHash: "a".repeat(64),
	status,
	createdAt: 1,
	expiresAt: past ? 1 : Date.now() + 60000,
	resolvedAt: null,
	error: null,
});
const teams = [{ id: "team-uuid", name: "真实团队" }] as Team[];
for (const [status, label] of [
	["executed", "Executed"],
	["rejected", "Rejected"],
	["failed", "Failed"],
	["claimed", "Processing"],
] as const) {
	test(`${status} keeps its authoritative status after the deadline without an expiry claim`, () => {
		const resolve = mock(() => {});
		const screen = render(
			<ButlerApprovalCard
				approval={approval(status)}
				teams={teams}
				workspaces={[]}
				pending={false}
				blocked={false}
				onResolve={resolve}
			/>,
		);
		expect(screen.getByRole("heading").textContent).toContain(label);
		expect(screen.queryByText(/^Expires?d? /)).toBeNull();
		expect(screen.queryByText("Expired")).toBeNull();
		expect(screen.queryByRole("button", { name: "Confirm stop" })).toBeNull();
		expect(screen.getByText("真实团队").closest("details")).toBeNull();
		const original = screen.getByText("Stop Team team-uuid");
		const details = original.closest("details");
		expect(details?.open).toBe(false);
		fireEvent.click(screen.getByText("Details"));
		expect(details?.open).toBe(true);
		expect(screen.getByText("team-uuid").closest("details")).toBe(details);
		expect(resolve).not.toHaveBeenCalled();
	});
}
for (const [status, past, expired] of [
	["pending", false, false],
	["pending", true, true],
	["expired", false, true],
] as const) {
	test(`${status} / past=${past} shows the applicable deadline and gates approval`, () => {
		const resolve = mock((_decision: "approve" | "reject") => {});
		const screen = render(
			<ButlerApprovalCard
				approval={approval(status, past)}
				teams={teams}
				workspaces={[]}
				pending={false}
				blocked={false}
				onResolve={resolve}
			/>,
		);
		expect(screen.getByText(expired ? /^Expired / : /^Expires /)).toBeTruthy();
		if (status === "pending") {
			const button = screen.getByRole("button", {
				name: "Confirm stop",
			}) as HTMLButtonElement;
			expect(button.disabled).toBe(expired);
			fireEvent.click(button);
			if (expired) expect(resolve).not.toHaveBeenCalled();
			else expect(resolve).toHaveBeenCalledWith("approve");
		} else
			expect(screen.queryByRole("button", { name: "Confirm stop" })).toBeNull();
	});
}
