import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ButlerConversation } from "./ButlerConversation";

afterEach(cleanup);
test("Butler sends human text verbatim and preserves one request ID across uncertain retries", async () => {
	const send = mock(async (_body: string, _id: string): Promise<never> => {
		throw new Error("offline");
	});
	const screen = render(
		<ButlerConversation
			messages={[]}
			disabled={false}
			loading={false}
			noKey={false}
			onSettings={() => {}}
			onSend={send}
		/>,
	);
	const field = screen.getByRole("textbox", { name: "Ask Butler…" });
	fireEvent.change(field, {
		target: { value: "  Human instruction\nkeep exact  " },
	});
	fireEvent.click(screen.getByRole("button", { name: "Send" }));
	await screen.findByText(
		"The result is uncertain. Retry this message with the same request ID.",
	);
	fireEvent.click(screen.getByRole("button", { name: "Send" }));
	await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
	expect(send.mock.calls[0]?.[0]).toBe("  Human instruction\nkeep exact  ");
	expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
	expect((field as HTMLTextAreaElement).value).toBe(
		"  Human instruction\nkeep exact  ",
	);
});
