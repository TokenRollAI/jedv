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
			mode="all"
			items={[item]}
			members={members}
			pending={false}
			readOnly={false}
			onConsume={consume}
		/>,
	);
	expect(screen.queryByRole("button", { name: /Acknowledge mail/ })).toBeNull();
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

test("key reports filters to human instructions with recipient badge, reports and delivery exceptions while all activity shows full mail", () => {
	const mail = (
		id: string,
		body: string,
		sourceKind = "member",
		error: string | null = null,
	) =>
		({
			event: {
				id,
				body,
				subject: "",
				sourceKind,
				sourceId: "worker",
				createdAt: 1,
			},
			deliveries: [
				{
					id,
					recipientMemberId: "leader",
					readAt: null,
					ackedAt: null,
					lastError: error,
				},
			],
		}) as MailItem;
	const consume = mock();
	const onInspect = mock();
	const items = [
		mail("internal", "technical prompt and paths"),
		mail(
			"instructions",
			"Follow this protocol:\nJEDV_WORKER_DONE\nsummary: placeholder",
		),
		mail("human", "Please prioritize this", "human"),
		mail("report", "JEDV_WORKER_BLOCKED\nreason: Need a decision"),
		mail("failed", "Delivery failed", "member", "offline"),
	];
	const members = [
		{ id: "leader", name: "leader" },
		{ id: "worker", name: "kimi-reviewer" },
	] as TeamMember[];
	const screen = render(
		<TeamMailTimeline
			mode="reports"
			items={items}
			members={members}
			pending={false}
			readOnly={false}
			onInspect={onInspect}
			onConsume={consume}
		/>,
	);
	expect(screen.queryByText("technical prompt and paths")).toBeNull();
	expect(screen.queryByText("placeholder")).toBeNull();
	expect(screen.getByText("You → leader")).toBeTruthy();
	expect(screen.getByText("Please prioritize this")).toBeTruthy();
	expect(screen.getByText("Need a decision")).toBeTruthy();
	expect(screen.getByRole("alert")).toBeTruthy();
	const [firstInspect] = screen.getAllByRole("button", {
		name: "View original mail",
	});
	if (!firstInspect) throw new Error("Missing View original mail button");
	fireEvent.click(firstInspect);
	expect(onInspect).toHaveBeenCalledWith("human");
	screen.rerender(
		<TeamMailTimeline
			mode="all"
			items={items}
			members={members}
			pending={false}
			readOnly={false}
			onConsume={consume}
		/>,
	);
	expect(screen.getByText("technical prompt and paths")).toBeTruthy();
	expect(consume).not.toHaveBeenCalled();
});

test("no-ACK mail shows its real read state without offering a fake acknowledgement", () => {
	const item = {
		event: {
			id: "no-ack",
			sourceKind: "human",
			sourceId: "human",
			createdAt: 1,
			subject: "Task",
			body: "Read only",
			requiresAck: false,
		},
		deliveries: [
			{ id: "read", recipientMemberId: "worker", readAt: 2, ackedAt: null },
		],
	} as MailItem;
	const consume = mock();
	const screen = render(
		<TeamMailTimeline
			mode="all"
			items={[item]}
			members={[{ id: "worker", name: "worker" }] as TeamMember[]}
			pending={false}
			readOnly={false}
			onConsume={consume}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Expand message" }));
	expect(screen.getByText("Read")).toBeTruthy();
	expect(screen.queryByText("Read, awaiting acknowledgement")).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Acknowledge mail to worker" }),
	).toBeNull();
	expect(consume).not.toHaveBeenCalled();
	expect(item.deliveries[0]?.ackedAt).toBeNull();
});
