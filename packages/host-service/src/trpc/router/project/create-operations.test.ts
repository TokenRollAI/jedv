import { expect, test } from "bun:test";
import type { HostServiceContext } from "../../../types";
import { getCreateOperation, runCreateOperation } from "./create-operations";

test("creation cancellation is reported only after work and rollback settle", async () => {
	const ctx = { db: {}, userId: "one" } as unknown as HostServiceContext;
	const controller = new AbortController();
	const gate = Promise.withResolvers<void>();
	let calls = 0;
	const input = {
		operationId: "request",
		name: "test",
		mode: { kind: "clone" },
	};
	const work = async () => {
		calls++;
		await gate.promise;
		throw new Error("stopped after rollback");
	};
	const pending = runCreateOperation(ctx, input, controller.signal, work);
	const duplicate = runCreateOperation(ctx, input, controller.signal, work);
	await Promise.resolve();
	controller.abort();
	expect(getCreateOperation(ctx, "request").status).toBe("running");
	expect(getCreateOperation({ ...ctx, userId: "two" }, "request").status).toBe(
		"unknown",
	);
	expect(duplicate).toBe(pending);
	gate.resolve();
	await expect(pending).rejects.toThrow("stopped after rollback");
	expect(calls).toBe(1);
	expect(getCreateOperation(ctx, "request").status).toBe("cancelled");
	expect(() =>
		runCreateOperation(ctx, { ...input, name: "different" }, undefined, work),
	).toThrow("another request");
});

test("a lost creation response can be recovered without creating twice", async () => {
	const ctx = { db: {} } as unknown as HostServiceContext;
	let calls = 0;
	const input = {
		operationId: "request",
		name: "test",
		mode: { kind: "empty" },
	};
	const result = {
		projectId: "project",
		repoPath: "/fixture/project",
		created: true,
	};
	const work = async () => {
		calls++;
		return result;
	};
	await runCreateOperation(ctx, input, undefined, work);
	expect(getCreateOperation(ctx, "request")).toEqual({
		status: "completed",
		result,
	});
	expect(await runCreateOperation(ctx, input, undefined, work)).toEqual(result);
	expect(calls).toBe(1);
});
