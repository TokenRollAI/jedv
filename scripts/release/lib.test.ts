import { describe, expect, test } from "bun:test";
import { unifiedErrors } from "./lib.ts";

describe("unifiedErrors", () => {
	const check = (d: string, vs: string[]) =>
		unifiedErrors(
			d,
			vs.map((v, i) => ({ name: `p${i}`, version: v })),
		);
	test("release state: cli == host == desktop", () => {
		expect(check("1.14.1", ["1.14.1", "1.14.1"])).toEqual([]);
	});
	test("hotfix leads desktop by a plain patch", () => {
		expect(check("1.14.1", ["1.14.2", "1.14.2"])).toEqual([]);
		expect(check("1.14.1", ["1.14.5", "1.14.5"])).toEqual([]);
	});
	test("rejects a prerelease suffix (fails the host floor)", () => {
		expect(check("1.14.1", ["1.14.2-1", "1.14.2-1"]).length).toBeGreaterThan(0);
	});
	test("rejects cli below desktop", () => {
		expect(check("1.14.1", ["1.14.0", "1.14.0"]).length).toBeGreaterThan(0);
	});
	test("rejects a different minor line", () => {
		expect(check("1.14.1", ["1.15.0", "1.15.0"]).length).toBeGreaterThan(0);
	});
	test("rejects packages that disagree", () => {
		expect(check("1.14.1", ["1.14.2", "1.14.3"]).length).toBeGreaterThan(0);
	});
	test("desktop must be a plain release", () => {
		expect(check("1.14.1-1", ["1.14.1-1"]).length).toBeGreaterThan(0);
	});
});
