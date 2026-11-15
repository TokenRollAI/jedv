import { expect, test } from "bun:test";
import { checkSetupBeforeLaunch } from "./check-setup";
import type { WorkspaceSetupStatus } from "./setup-state";

function status(
	value: NonNullable<WorkspaceSetupStatus>["status"],
): WorkspaceSetupStatus {
	return {
		workspaceId: "fixture",
		terminalId: "setup",
		status: value,
		exitCode: null,
		exitSignal: null,
		startedAt: 1,
		finishedAt: null,
	};
}
test("reads the current setting for every launch, and only actual false skips setup", async () => {
	const calls: string[] = [];
	let enabled = false;
	const deps = {
		readWait: async () => {
			calls.push("setting");
			return enabled;
		},
		readSetup: async () => {
			calls.push("setup");
			return status("running");
		},
		isCurrent: () => true,
	};
	expect((await checkSetupBeforeLaunch(deps)).allowed).toBe(true);
	enabled = true;
	expect((await checkSetupBeforeLaunch(deps)).allowed).toBe(false);
	expect(calls).toEqual(["setting", "setting", "setup"]);
});
test("only succeeded and not-required allow a launch when waiting is enabled", async () => {
	for (const value of [
		"not-required",
		"running",
		"succeeded",
		"failed",
		"unknown",
		null,
	] as const) {
		const result = await checkSetupBeforeLaunch({
			readWait: async () => true,
			readSetup: async () => (value === null ? null : status(value)),
			isCurrent: () => true,
		});
		expect(result.allowed).toBe(
			value === "not-required" || value === "succeeded",
		);
	}
});
test("a setting read failure never queries setup or produces permission to launch", async () => {
	let queried = false;
	await expect(
		checkSetupBeforeLaunch({
			readWait: async () => {
				throw new Error("settings unavailable");
			},
			readSetup: async () => {
				queried = true;
				return status("succeeded");
			},
			isCurrent: () => true,
		}),
	).rejects.toThrow("settings unavailable");
	expect(queried).toBe(false);
});
test("a context change during either read refuses the completed request", async () => {
	let valid = true;
	let queried = false;
	const first = await checkSetupBeforeLaunch({
		readWait: async () => {
			valid = false;
			return false;
		},
		readSetup: async () => {
			queried = true;
			return status("succeeded");
		},
		isCurrent: () => valid,
	});
	expect(first).toMatchObject({ allowed: false, stale: true });
	expect(queried).toBe(false);
	valid = true;
	const second = await checkSetupBeforeLaunch({
		readWait: async () => true,
		readSetup: async () => {
			valid = false;
			return status("succeeded");
		},
		isCurrent: () => valid,
	});
	expect(second).toMatchObject({ allowed: false, stale: true });
});
