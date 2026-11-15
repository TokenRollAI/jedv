import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { automationsRouter } from "../trpc/router/automations";
import type { HostServiceContext } from "../types";
import {
	type AutomationClock,
	type AutomationExecutor,
	LocalAutomations,
} from "./automations";
import { AutomationStore } from "./store";
import { createAutomationTestHost } from "./test-host";

const homes: string[] = [];
const services: LocalAutomations[] = [];
afterEach(() => {
	for (const service of services.splice(0)) service.dispose();
	for (const home of homes.splice(0))
		rmSync(home, { recursive: true, force: true });
});
const input = {
	name: "Review",
	prompt: "Review the changes",
	agent: "kimi" as const,
	target: { kind: "workspace" as const, workspaceId: "workspace-1" },
};
const drain = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(execute: AutomationExecutor = async () => {}) {
	const home = mkdtempSync(join(tmpdir(), "jedv-automations-"));
	homes.push(home);
	let now = Date.UTC(2026, 10, 13, 12);
	let tick: (() => void) | undefined;
	let cleared = false;
	const clock: AutomationClock = {
		now: () => now,
		setInterval(callback, ms) {
			expect(ms).toBe(30_000);
			tick = callback;
			return () => {
				cleared = true;
				tick = undefined;
			};
		},
	};
	const create = () => {
		const service = new LocalAutomations({ home, execute, clock });
		services.push(service);
		return service;
	};
	const service = create();
	return {
		service,
		create,
		home,
		advance: (ms: number) => {
			now += ms;
		},
		tick: () => tick?.(),
		clock,
		cleared: () => cleared,
	};
}

test("CRUD persists locally, validates schedules and recalculates on enable/update", () => {
	const f = fixture();
	const definition = f.service.create({
		...input,
		rrule: "FREQ=MINUTELY;INTERVAL=1",
		timezone: "UTC",
	});
	expect(definition.nextRunAt).toBe(f.clock.now() + 60_000);
	f.advance(120_000);
	expect(
		f.service.update(definition.id, { enabled: false }).nextRunAt,
	).toBeNull();
	expect(f.service.update(definition.id, { enabled: true }).nextRunAt).toBe(
		f.clock.now() + 60_000,
	);
	expect(() =>
		f.service.update(definition.id, { timezone: "not-a-timezone" }),
	).toThrow();
	expect(() =>
		f.service.create({ ...input, rrule: "FREQ=DAILY;COUNT=1" }),
	).toThrow();
	expect(f.create().get(definition.id).name).toBe("Review");
	f.service.remove(definition.id);
	expect(f.service.list()).toEqual([]);
});

test("one overdue occurrence is claimed durably with no reentry or restart replay", async () => {
	let complete!: () => void;
	let calls = 0;
	const f = fixture(async (_definition, _run, update) => {
		calls++;
		update({ status: "running" });
		await new Promise<void>((resolve) => {
			complete = resolve;
		});
	});
	const definition = f.service.create({
		...input,
		rrule: "FREQ=MINUTELY;INTERVAL=1",
	});
	f.service.start();
	f.advance(3 * 24 * 60 * 60_000);
	f.tick();
	f.tick();
	expect(calls).toBe(1);
	expect(f.service.listRuns(definition.id)[0]?.status).toBe("running");
	expect(() => f.service.runNow(definition.id)).toThrow("running");
	expect(() => f.service.remove(definition.id)).toThrow("running");
	const disk = JSON.parse(
		readFileSync(join(f.home, "automations.json"), "utf8"),
	);
	expect(disk.runs[0].scheduledAt).toBe(definition.nextRunAt);
	expect(disk.definitions[0].nextRunAt).toBeGreaterThan(f.clock.now());
	f.service.dispose();
	const restarted = f.create();
	restarted.tick();
	expect(calls).toBe(1);
	expect(restarted.listRuns(definition.id)[0]?.status).toBe("interrupted");
	complete();
	await drain();
	expect(restarted.listRuns(definition.id)[0]?.status).toBe("interrupted");
});

test("manual runs work while disabled and retain only the latest 50 records", async () => {
	const f = fixture();
	const definition = f.service.create({ ...input, enabled: false });
	for (let i = 0; i < 52; i++) {
		f.advance(1);
		f.service.runNow(definition.id);
		await drain();
	}
	const runs = f.service.listRuns(definition.id);
	expect(runs).toHaveLength(50);
	expect(
		runs.every((run) => run.status === "succeeded" && run.trigger === "manual"),
	).toBe(true);
	expect(
		new AutomationStore(join(f.home, "automations.json")).read().runs,
	).toHaveLength(50);
});

test("failure is recorded and dispose clears the timer and interrupts observers", async () => {
	const failed = fixture(async () => {
		throw new Error("provider authentication required");
	});
	const definition = failed.service.create(input);
	failed.service.runNow(definition.id);
	await drain();
	expect(failed.service.listRuns(definition.id)[0]).toMatchObject({
		status: "failed",
		error: "provider authentication required",
	});
	const f = fixture(
		async (_definition, _run, _update, signal) =>
			await new Promise((_resolve, reject) =>
				signal.addEventListener("abort", () => reject(new Error("closed")), {
					once: true,
				}),
			),
	);
	const active = f.service.create(input);
	f.service.start();
	f.service.runNow(active.id);
	f.service.dispose();
	await drain();
	expect(f.cleared()).toBe(true);
	expect(
		new AutomationStore(join(f.home, "automations.json")).read().runs[0]
			?.status,
	).toBe("interrupted");
});

test("corrupt files fail explicitly and are never overwritten", () => {
	const f = fixture();
	const path = join(f.home, "automations.json");
	writeFileSync(path, "{broken");
	expect(() => f.create()).toThrow("Cannot load local automations");
	expect(readFileSync(path, "utf8")).toBe("{broken");
	writeFileSync(
		path,
		JSON.stringify({ version: 99, definitions: [], runs: [] }),
	);
	expect(() => f.create()).toThrow("Cannot load");
});

test("the automation router requires authentication and uses the local service", async () => {
	const f = fixture();
	const context = {
		runtime: { automations: f.service },
		isAuthenticated: true,
	} as unknown as HostServiceContext;
	const caller = automationsRouter.createCaller(context);
	const created = await caller.create(input);
	expect(await caller.list()).toHaveLength(1);
	expect(
		(await caller.setEnabled({ id: created.id, enabled: false })).enabled,
	).toBe(false);
	await expect(
		automationsRouter
			.createCaller({ ...context, isAuthenticated: false })
			.list(),
	).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	await caller.remove({ id: created.id });
	expect(await caller.list()).toEqual([]);
});

test("a corrupt automation file disables only automation while the host keeps serving", async () => {
	const home = mkdtempSync(join(tmpdir(), "jedv-corrupt-automation-host-"));
	homes.push(home);
	const prior = process.env.JEDV_HOME_DIR;
	process.env.JEDV_HOME_DIR = home;
	const path = join(home, "automations.json");
	writeFileSync(path, "{broken-user-definition");
	const host = createAutomationTestHost(home);
	try {
		expect((await host.request("project.list")).status).toBe(200);
		expect((await host.request("workspace.list")).status).toBe(200);
		expect((await host.request("health.check")).status).toBe(200);
		const response = await host.request("automations.list");
		expect(response.status).toBe(503);
		expect(await response.text()).toContain("Cannot load local automations");
		expect(readFileSync(path, "utf8")).toBe("{broken-user-definition");
	} finally {
		await host.dispose();
		if (prior === undefined) delete process.env.JEDV_HOME_DIR;
		else process.env.JEDV_HOME_DIR = prior;
	}
});
