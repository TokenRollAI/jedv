import { expect, test } from "bun:test";
import { desiredPluginMcpServers, pluginProxyMcpServers } from "./index";

test("local-only setup never creates a hosted plugin endpoint from legacy installs", () => {
	expect(pluginProxyMcpServers("linear")).toBeUndefined();
	expect(pluginProxyMcpServers("jedv")).toBeUndefined();
	expect(desiredPluginMcpServers([])).toEqual({});
	expect(
		desiredPluginMcpServers([
			{ name: "linear" },
			{ name: "deploy", marketplace: "organization-legacy" },
			{ name: "team-skills", marketplace: "organization-legacy", tools: false },
			{ name: "local", marketplace: "custom" },
		]),
	).toEqual({});
});
