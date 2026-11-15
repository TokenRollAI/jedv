import { describe, expect, test } from "bun:test";
import { FIRST_PARTY_MANIFESTS } from "./bundled-manifests";
import {
	getPluginByName,
	isServerSatisfiedExternally,
	PLUGIN_CATALOG,
} from "./index";

describe("PLUGIN_CATALOG", () => {
	test("offers no bundled or published plugins", () => {
		expect(PLUGIN_CATALOG).toEqual([]);
		expect(FIRST_PARTY_MANIFESTS).toEqual({});
		expect(getPluginByName("jedv")).toBeUndefined();
		expect(getPluginByName("linear")).toBeUndefined();
	});
});

describe("isServerSatisfiedExternally", () => {
	const proxy = "https://api.example.test/mcp/plugins/jedv/linear";
	const linear = { type: "http", url: proxy } as const;

	test("a user's Jedv MCP entry does not satisfy a proxied plugin", () => {
		expect(
			isServerSatisfiedExternally("linear", linear, [
				{ name: "jedv", url: "https://api.example.test/mcp" },
			]),
		).toBe(false);
	});

	test("an entry for the same proxy path satisfies it", () => {
		expect(
			isServerSatisfiedExternally("linear", linear, [
				{ name: "my-linear", url: `${proxy}/` },
			]),
		).toBe(true);
	});

	test("an entry pinned to one account satisfies only that account", () => {
		const external = [
			{ name: "my-linear", url: `${proxy}?connection=conn-work` },
		];
		const pinned = (connection: string) =>
			({ type: "http", url: `${proxy}?connection=${connection}` }) as const;
		expect(
			isServerSatisfiedExternally("linear-work", pinned("conn-work"), external),
		).toBe(true);
		expect(
			isServerSatisfiedExternally("linear-side", pinned("conn-side"), external),
		).toBe(false);
	});

	test("a legacy Jedv MCP URL still satisfies the jedv server", () => {
		expect(
			isServerSatisfiedExternally(
				"jedv",
				{ type: "http", url: "https://api.example.test/mcp" },
				[
					{
						name: "jedv-mcp",
						url: "https://api.example.test/api/v2/agent/mcp",
					},
				],
			),
		).toBe(true);
	});

	test("a vendor URL still matches by hostname", () => {
		expect(
			isServerSatisfiedExternally(
				"playwright",
				{ type: "http", url: "https://mcp.example.com/mcp" },
				[{ name: "pw", url: "https://mcp.example.com/sse" }],
			),
		).toBe(true);
	});
});
