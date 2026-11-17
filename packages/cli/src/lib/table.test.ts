import { describe, expect, test } from "bun:test";
import { table } from "./table";

describe("table", () => {
	test("aligns CJK and ASCII columns using terminal display width", () => {
		const output = table(
			[
				{ name: "测试项目", repo: "-", path: "/tmp/a", id: "p-1" },
				{ name: "jedv", repo: "-", path: "/tmp/b", id: "p-2" },
			],
			["name", "repo", "path", "id"],
			["NAME", "REPO", "PATH", "ID"],
		);
		const lines = output.split("\n");
		expect(lines).toHaveLength(3);
		const widths = lines.map((line) => Bun.stringWidth(line));
		expect(widths[0]).toBe(widths[1]);
		expect(widths[1]).toBe(widths[2]);
		expect(lines[0]?.indexOf("REPO")).toBe(
			Bun.stringWidth(lines[1]!.slice(0, lines[1]!.indexOf("-"))),
		);
		expect(lines[0]?.indexOf("REPO")).toBe(
			Bun.stringWidth(lines[2]!.slice(0, lines[2]!.indexOf("-"))),
		);
	});

	test("truncates wide CJK text without exceeding maxColWidth display columns", () => {
		const output = table(
			[{ name: "这是一个非常长的中文项目名称" }],
			["name"],
			["NAME"],
			[10],
		);
		const body = output.split("\n")[1] ?? "";
		expect(Bun.stringWidth(body)).toBeLessThanOrEqual(10);
		expect(body.endsWith("…")).toBe(true);
	});
});
