import { afterAll, describe, expect, test } from "bun:test";

const originalEnv = {
	HOST_DB_PATH: process.env.HOST_DB_PATH,
	HOST_MIGRATIONS_FOLDER: process.env.HOST_MIGRATIONS_FOLDER,
	HOST_SERVICE_SECRET: process.env.HOST_SERVICE_SECRET,
	ORGANIZATION_ID: process.env.ORGANIZATION_ID,
	PORT: process.env.PORT,
};

process.env.HOST_DB_PATH = "/tmp/jedv-host.db";
process.env.HOST_MIGRATIONS_FOLDER = "/tmp/jedv-migrations";
process.env.HOST_SERVICE_SECRET = "host-secret";
process.env.ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
process.env.PORT = "4879";

const { env } = await import("./env");

afterAll(() => {
	for (const [key, value] of Object.entries(originalEnv)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe("host-service env", () => {
	test("requires local paths and no cloud credentials", () => {
		expect(env.HOST_DB_PATH).toBe("/tmp/jedv-host.db");
		expect(env.HOST_SERVICE_SECRET).toBe("host-secret");
		expect("AUTH_TOKEN" in env).toBe(false);
		expect("JEDV_API_URL" in env).toBe(false);
	});
});
