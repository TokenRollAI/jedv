import { expect, test } from "bun:test";
import {
	historyLocation,
	pushShellLocation,
	type ShellHistory,
} from "./history";

test("window history branches after Back and keeps only 64 local navigation targets", () => {
	const history: ShellHistory = { entries: [], index: -1 };
	for (let index = 0; index < 70; index++)
		pushShellLocation(history, {
			hostUrl: "https://host.ts.net",
			workspaceId: String(index),
			terminalId: null,
			surface: "terminal",
		});
	expect(history.entries).toHaveLength(64);
	const back = historyLocation(history, -1);
	expect(back?.location.workspaceId).toBe("68");
	if (!back) return;
	history.index = back.index;
	pushShellLocation(history, {
		hostUrl: "http://127.0.0.1:1234",
		workspaceId: "local",
		terminalId: null,
		surface: "files",
		path: "smoke.txt",
	});
	expect(historyLocation(history, 1)).toBeNull();
	expect(history.entries.at(-1)?.hostUrl).toBe("http://127.0.0.1:1234");
});
