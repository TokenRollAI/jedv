import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { TeamMember } from "../../../../hooks/useTeamwork";
import { TeamMailComposer } from "./TeamMailComposer";

afterEach(cleanup);
const members = [
	{ id: "leader-id", name: "leader", status: "active" },
	{ id: "worker-id", name: "worker", status: "active" },
] as TeamMember[];
test("failed human mail retains its verbatim draft and retry identity; edited mail gets a new identity", async () => {
	const send = mock(async (_to: string, _body: string, _dedupeKey: string) => {
		throw new Error("offline");
	});
	const screen = render(
		<TeamMailComposer
			members={members}
			disabled={false}
			pending={false}
			onSend={send}
		/>,
	);
	const textbox = screen.getByRole("textbox", { name: "Message to team" });
	fireEvent.change(textbox, { target: { value: "  original\nmessage  " } });
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
	expect(send.mock.calls[0]?.slice(0, 2)).toEqual([
		"leader",
		"  original\nmessage  ",
	]);
	expect((textbox as HTMLTextAreaElement).value).toBe("  original\nmessage  ");
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
	fireEvent.click(screen.getByRole("combobox", { name: "Mail recipient" }));
	fireEvent.click(await screen.findByRole("option", { name: "worker" }));
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
	expect(send.mock.calls[2]?.[0]).toBe("worker");
	expect(send.mock.calls[2]?.[2]).not.toBe(send.mock.calls[0]?.[2]);
});
test("a pending send cannot be submitted twice and clears the draft only after success", async () => {
	let finish: () => void = () => {};
	const send = mock(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const screen = render(
		<TeamMailComposer
			members={members}
			disabled={false}
			pending={false}
			onSend={send}
		/>,
	);
	const textbox = screen.getByRole("textbox", { name: "Message to team" });
	fireEvent.change(textbox, { target: { value: "work" } });
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	expect(send).toHaveBeenCalledTimes(1);
	expect((textbox as HTMLTextAreaElement).value).toBe("work");
	finish();
	await waitFor(() => expect((textbox as HTMLTextAreaElement).value).toBe(""));
});

test("explicit interrupt selection is sent with ACK requirement and retained on refusal", async () => {
	const send = mock(async (..._args: unknown[]) => {
		throw new Error("Safe interrupt unavailable");
	});
	const screen = render(
		<TeamMailComposer
			members={members}
			disabled={false}
			pending={false}
			deliveryModesSupported
			interruptSupported
			onSend={send}
		/>,
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Message to team" }), {
		target: { value: "Please stop and inspect" },
	});
	fireEvent.change(screen.getByRole("combobox", { name: "Delivery mode" }), {
		target: { value: "interrupt" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
	expect(send.mock.calls[0]?.[3]).toEqual({
		deliveryMode: "interrupt",
		requiresAck: true,
	});
	expect(
		(
			screen.getByRole("textbox", {
				name: "Message to team",
			}) as HTMLTextAreaElement
		).value,
	).toBe("Please stop and inspect");
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
});
test("older Hosts cannot accidentally receive an unsupported interrupt", () => {
	const send = mock(async () => {});
	const screen = render(
		<TeamMailComposer
			members={members}
			disabled={false}
			pending={false}
			onSend={send}
		/>,
	);
	expect(
		(screen.getByRole("option", { name: "Interrupt now" }) as HTMLOptionElement)
			.disabled,
	).toBe(true);
	fireEvent.change(screen.getByRole("textbox", { name: "Message to team" }), {
		target: { value: "keep" },
	});
	fireEvent.change(screen.getByRole("combobox", { name: "Delivery mode" }), {
		target: { value: "interrupt" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	expect(send).not.toHaveBeenCalled();
});

test("delivery mode support alone cannot enable interruption or send a retained urgent draft", async () => {
	const send = mock(async (..._args: unknown[]) => {
		throw new Error("offline");
	});
	const screen = render(
		<TeamMailComposer
			members={members}
			disabled={false}
			pending={false}
			deliveryModesSupported
			interruptSupported
			onSend={send}
		/>,
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Message to team" }), {
		target: { value: "preserve urgent" },
	});
	fireEvent.change(screen.getByRole("combobox", { name: "Delivery mode" }), {
		target: { value: "interrupt" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
	screen.rerender(
		<TeamMailComposer
			members={members}
			disabled={false}
			pending={false}
			deliveryModesSupported
			interruptSupported={false}
			onSend={send}
		/>,
	);
	expect(
		(screen.getByRole("option", { name: "Interrupt now" }) as HTMLOptionElement)
			.disabled,
	).toBe(true);
	expect(
		(screen.getByRole("button", { name: "Send mail" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	expect(send).toHaveBeenCalledTimes(1);
	expect(
		(
			screen.getByRole("textbox", {
				name: "Message to team",
			}) as HTMLTextAreaElement
		).value,
	).toBe("preserve urgent");
	screen.rerender(
		<TeamMailComposer
			members={members}
			disabled={false}
			pending={false}
			deliveryModesSupported
			interruptSupported
			onSend={send}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Send mail" }));
	await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
});
