import { expect, test } from "bun:test";
import { getDefaultSeedPresets } from "./host-agent-presets";

test("new hosts seed only the four supported native agents", () => {
	const presets = getDefaultSeedPresets();
	expect(presets.map((preset) => preset.presetId).sort()).toEqual([
		"agy",
		"claude",
		"codex",
		"kimi",
	]);
	const kimi = presets.find((preset) => preset.presetId === "kimi");
	expect(kimi).toMatchObject({
		command: "kimi",
		args: ["--yolo"],
		resumeArgs: ["--session"],
	});
	presets[0]?.args.push("mutated");
	expect(getDefaultSeedPresets()[0]?.args).not.toContain("mutated");
});
