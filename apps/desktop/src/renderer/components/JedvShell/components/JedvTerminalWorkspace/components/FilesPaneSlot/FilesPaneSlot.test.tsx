import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createPortal } from "react-dom";
import { FilesPaneSlot, filesSurfaceMatches } from "./FilesPaneSlot";

afterEach(cleanup);
test("a files document stays with its workspace and preserves its draft when its pane moves", () => {
	const host = document.createElement("div");
	const target = { hostUrl: "http://host-a", workspaceId: "a" };
	const fixture = (workspaceId: string) => (
		<>
			<div id="jedv-files-parking" hidden />
			<div data-testid="workspace">
				<FilesPaneSlot
					host={
						filesSurfaceMatches(target, "http://host-a", workspaceId)
							? host
							: null
					}
					active
					onActivate={() => {}}
				/>
			</div>
			{createPortal(<textarea aria-label="Draft" defaultValue="saved" />, host)}
		</>
	);
	const view = render(fixture("a"));
	const input = host.querySelector("textarea");
	if (!input) throw new Error("Draft was not mounted");
	input.value = "unsaved";
	view.rerender(fixture("b"));
	expect(view.getByTestId("workspace").contains(input)).toBe(false);
	expect(document.getElementById("jedv-files-parking")?.contains(input)).toBe(
		true,
	);
	view.rerender(fixture("a"));
	expect(view.getByTestId("workspace").contains(input)).toBe(true);
	expect(host.querySelector("textarea")).toBe(input);
	expect(input.value).toBe("unsaved");
});
