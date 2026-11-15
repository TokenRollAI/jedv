import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	issueAttributionToken,
	verifyAttributionToken,
} from "./attribution-token";

test("attribution tokens authorize only their owning terminal", () => {
	const token = issueAttributionToken("terminal-a");
	expect(verifyAttributionToken("terminal-a", token)).toBe(true);
	expect(verifyAttributionToken("terminal-b", token)).toBe(false);
	for (const invalid of [
		undefined,
		"",
		"a".repeat(64),
		token.slice(1),
		"z".repeat(64),
	]) {
		expect(verifyAttributionToken("terminal-a", invalid)).toBe(false);
	}
});

test("a new host process verifies the same terminal token in the isolated profile", async () => {
	const token = issueAttributionToken("restart-terminal");
	const moduleUrl = pathToFileURL(
		join(import.meta.dir, "attribution-token.ts"),
	).href;
	const child = Bun.spawn(
		[
			process.execPath,
			"-e",
			`import {issueAttributionToken} from ${JSON.stringify(moduleUrl)}; process.stdout.write(issueAttributionToken('restart-terminal'));`,
		],
		{ env: process.env, stdout: "pipe", stderr: "pipe" },
	);
	const [code, output] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
	]);
	expect(code).toBe(0);
	expect(output).toBe(token);
});
