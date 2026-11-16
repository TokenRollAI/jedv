import { expect, test } from "bun:test";
import { withLocalHostService } from "../../../lib/host/test-helpers";
import statusCommand from "./command";

const workspace = "00000000-0000-4000-8000-000000000001";
let input: Record<string, unknown> | undefined;
const procedures: Parameters<typeof withLocalHostService>[1] = {
	"workspace.list": () => [{ id: workspace }],
	"agents.launchStatus": (value) => {
		input = value;
		return { state: "failed", exitCode: 2 };
	},
};
withLocalHostService("org-1", procedures);
function invoke() {
	return statusCommand.run({
		ctx: { config: { organizationId: "org-1" } } as never,
		args: {} as never,
		options: {
			workspace,
			local: true,
			terminal: "terminal",
			run: "run",
		} as never,
		signal: new AbortController().signal,
	});
}
test("queries exact terminal/run identity and exposes failure", async () => {
	expect(await invoke()).toEqual({ data: { state: "failed", exitCode: 2 } });
	expect(input).toEqual({
		workspaceId: workspace,
		sessionId: "terminal",
		runId: "run",
	});
});
test("older hosts return unknown instead of suggesting readiness", async () => {
	const original = procedures["agents.launchStatus"];
	delete procedures["agents.launchStatus"];
	try {
		expect(await invoke()).toEqual({
			data: { state: "unknown", supported: false },
		});
	} finally {
		if (original) procedures["agents.launchStatus"] = original;
	}
});
test("real host errors remain visible", async () => {
	const original = procedures["agents.launchStatus"];
	procedures["agents.launchStatus"] = () => {
		throw new Error("fixture offline");
	};
	try {
		await expect(invoke()).rejects.toThrow("fixture offline");
	} finally {
		if (original) procedures["agents.launchStatus"] = original;
	}
});
