import { afterEach, expect, mock, test } from "bun:test";
import type { ButlerMessageShape } from "@jedv/shared/butler";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ButlerChatMessage } from "./ButlerChatMessage";

afterEach(cleanup);
const message = (
	role: ButlerMessageShape["role"],
	content: string,
): ButlerMessageShape => ({
	id: "message",
	threadId: "thread",
	requestId: "request",
	role,
	content,
	createdAt: 1,
});
test("assistant Markdown uses the real renderer, skips HTML and opens only safe explicit links", async () => {
	const open = mock(async (_url: string) => {});
	const content =
		'## Result\n\n**Done** and [docs](https://example.com).\n\n<script>unsafe()</script>\n\n<iframe src="https://example.com"></iframe>\n\n[unsafe](javascript:alert%281%29)';
	const screen = render(
		<ButlerChatMessage
			message={message("assistant", content)}
			onOpenUrl={open}
		/>,
	);
	expect(await screen.findByRole("heading", { name: "Result" })).toBeTruthy();
	expect(screen.getByText("Done")).toBeTruthy();
	expect(screen.container.textContent).not.toContain("**Done**");
	expect(screen.container.querySelector("script,iframe,b")).toBeNull();
	expect(screen.queryByRole("link", { name: "unsafe" })).toBeNull();
	expect(open).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("link", { name: "docs" }));
	expect(open).toHaveBeenCalledWith("https://example.com/");
});
test("human text stays verbatim and tool output is a disclosure, never an approval control", () => {
	const screen = render(
		<>
			<ButlerChatMessage
				message={message("human", "  **Original**\n    indent")}
			/>
			<ButlerChatMessage
				message={message("tool", '{"approved":true,"raw":"<script>"}')}
			/>
		</>,
	);
	expect(screen.getByText(/\*\*Original\*\*/).textContent).toBe(
		"  **Original**\n    indent",
	);
	expect(screen.container.querySelector("strong,script")).toBeNull();
	const summary = screen.getByText("Tool output");
	fireEvent.click(summary);
	expect(summary.closest("details")?.open).toBe(true);
	expect(screen.queryByRole("button", { name: /approve|confirm/i })).toBeNull();
});

test("tool lifecycle names the running call, updates failure and redacts credentials", () => {
	const screen = render(
		<ButlerChatMessage
			message={message(
				"tool",
				JSON.stringify({
					version: 1,
					tool: "listProjects",
					callId: "call",
					status: "running",
					parametersSummary: { token: "fixture-secret", project: "project" },
				}),
			)}
		/>,
	);
	expect(screen.getByText("listProjects")).toBeTruthy();
	expect(screen.getByRole("status").textContent).toBe("Running");
	expect(screen.container.textContent).not.toContain("fixture-secret");
	screen.rerender(
		<ButlerChatMessage
			message={message(
				"tool",
				JSON.stringify({
					version: 1,
					tool: "listProjects",
					callId: "call",
					status: "failed",
					error: "Host unavailable",
				}),
			)}
		/>,
	);
	expect(screen.getByRole("status").textContent).toBe("Failed");
	fireEvent.click(screen.getByText("listProjects"));
	expect(screen.container.textContent).toContain("Host unavailable");
	expect(screen.container.querySelector("details")?.open).toBe(true);
	screen.rerender(
		<ButlerChatMessage
			message={message(
				"tool",
				JSON.stringify({ tool: "listProjects", result: { count: 3 } }),
			)}
		/>,
	);
	expect(screen.getByRole("status").textContent).toBe("Succeeded");
});
test("malformed legacy output does not claim success or expose raw sensitive fragments", () => {
	const screen = render(
		<ButlerChatMessage
			message={message("tool", '{"token":"secret-fragment')}
		/>,
	);
	expect(screen.getByRole("status").textContent).toBe("Status unavailable");
	expect(screen.container.textContent).not.toContain("secret-fragment");
});
