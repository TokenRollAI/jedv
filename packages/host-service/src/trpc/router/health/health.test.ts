import { expect, test } from "bun:test";
import type { HostServiceContext } from "../../../types";
import { healthRouter } from "./health";

test("health reports the local process without cloud or sandbox metadata", async () => {
	const result = await healthRouter
		.createCaller({} as HostServiceContext)
		.check();
	expect(result).toEqual({
		status: "ok",
		pid: process.pid,
		version: expect.any(String),
		installSource: expect.any(String),
	});
});
