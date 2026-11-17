import { describe, expect, test } from "bun:test";
import { withLocalHostService } from "../../lib/host/test-helpers";
import snapshotCommand from "./command";

withLocalHostService("org-1", {
	"workspace.list": () => [],
	"terminal.list": () => ({ sessions: [] }),
	"terminalAgents.list": () => [],
});

describe("snapshot", () => {
	test("accepts --local harmlessly alongside default local targeting", async () => {
		const res = (await snapshotCommand.run({
			ctx: {
				api: {},
				config: { organizationId: "org-1" },
				bearer: "b",
			} as never,
			args: {} as never,
			options: { local: true } as never,
			signal: new AbortController().signal,
		})) as { data: { workspaces: unknown[] }; message: string };
		expect(res.data.workspaces).toEqual([]);
		expect(res.message).toBe("No workspaces on this host.");
	});

	test("rejects --host and --local together", async () => {
		await expect(
			snapshotCommand.run({
				ctx: {
					api: {},
					config: { organizationId: "org-1" },
					bearer: "b",
				} as never,
				args: {} as never,
				options: { host: "other-host", local: true } as never,
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("Pass either --host or --local, not both");
	});
});
