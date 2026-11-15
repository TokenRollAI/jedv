import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import { createTestHost, type TestHost } from "../helpers/createTestHost";

describe("host-service smoke", () => {
	let host: TestHost;

	beforeEach(async () => {
		host = await createTestHost();
	});

	afterEach(async () => {
		await host.dispose();
	});

	test("health.check returns ok without auth", async () => {
		const result = await host.unauthenticatedTrpc.health.check.query();
		expect(result).toEqual({
			status: "ok",
			pid: process.pid,
			version: expect.stringMatching(/^\d+\.\d+\.\d+/),
			installSource: expect.stringMatching(/^(cli|desktop|dev|unknown)$/),
		});
	});

	test("health.check returns ok with auth", async () => {
		const result = await host.trpc.health.check.query();
		expect(result).toEqual({
			status: "ok",
			pid: process.pid,
			version: expect.stringMatching(/^\d+\.\d+\.\d+/),
			installSource: expect.stringMatching(/^(cli|desktop|dev|unknown)$/),
		});
	});

	test("protected procedure rejects requests without bearer token", async () => {
		await expect(
			host.unauthenticatedTrpc.host.info.query(),
		).rejects.toBeInstanceOf(TRPCClientError);
	});

	test("host.info reports the local runtime", async () => {
		const info = await host.trpc.host.info.query();
		expect(info.platform).toBe(process.platform);
		expect(typeof info.uptime).toBe("number");
		expect("organization" in info).toBe(false);
	});

	test("CORS preflight allows configured origin and rejects others", async () => {
		const allowed = await host.fetch(
			"http://host-service.test/trpc/health.check",
			{
				method: "OPTIONS",
				headers: {
					origin: "http://localhost:5173",
					"access-control-request-method": "GET",
					"access-control-request-headers": "content-type",
				},
			},
		);
		expect(allowed.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:5173",
		);

		const rejected = await host.fetch(
			"http://host-service.test/trpc/health.check",
			{
				method: "OPTIONS",
				headers: {
					origin: "http://evil.example",
					"access-control-request-method": "GET",
				},
			},
		);
		// A misconfigured wildcard `*` would also satisfy `not.toBe("http://evil.example")`
		// — assert the header is absent entirely, which is what Hono's CORS
		// middleware does for a non-allowlisted origin.
		expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
	});

	test("websocket routes reject unauthenticated upgrade attempts", async () => {
		const res = await host.fetch("http://host-service.test/events");
		expect(res.status).toBe(401);
	});
});
