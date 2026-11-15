import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { MailItem, TeamMember } from "../../../../hooks/useTeamwork";
import { TeamMailTimeline } from "./TeamMailTimeline";

afterEach(cleanup);
test("read and acknowledgement are separate explicit actions per recipient", () => {
	const item = {
		event: {
			id: "mail",
			sourceKind: "human",
			sourceId: "human",
			createdAt: 1,
			subject: "Task",
			body: "Original message",
		},
		deliveries: [
			{
				id: "unread",
				recipientMemberId: "leader",
				readAt: null,
				ackedAt: null,
			},
			{ id: "read", recipientMemberId: "worker", readAt: 2, ackedAt: null },
			{ id: "acked", recipientMemberId: "done", readAt: 2, ackedAt: 3 },
		],
	} as MailItem;
	const members = ["leader", "worker", "done"].map((id) => ({
		id,
		name: id,
	})) as TeamMember[];
	const consume = mock();
	const screen = render(
		<TeamMailTimeline
			items={[item]}
			members={members}
			pending={false}
			readOnly={false}
			onConsume={consume}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Expand message" }));
	expect(consume).not.toHaveBeenCalled();
	fireEvent.click(
		screen.getByRole("button", { name: "Mark mail to leader as read" }),
	);
	expect(consume).toHaveBeenLastCalledWith("unread", false);
	fireEvent.click(
		screen.getByRole("button", { name: "Acknowledge mail to worker" }),
	);
	expect(consume).toHaveBeenLastCalledWith("read", true);
	expect(
		screen.queryByRole("button", { name: "Mark mail to worker as read" }),
	).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Acknowledge mail to done" }),
	).toBeNull();
	expect(screen.getByText("Read, awaiting acknowledgement")).toBeTruthy();
});
