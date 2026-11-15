import { expect, test } from "bun:test";
import { getAgentCommandText } from "./agent-launch-command";
import {
	resolvePresetAgentLink,
	syncLinkedPresetSnapshots,
} from "./linked-terminal-presets";

const agent = {
	id: "00000000-0000-4000-8000-000000000001",
	presetId: "claude",
	label: "Work",
	command: "claude",
	args: ["--resume"],
	env: {},
};

test("an explicit association refuses missing or ambiguous configs and every remote host", () => {
	expect(
		resolvePresetAgentLink(
			{ agentId: agent.id },
			[{ ...agent, id: "other", presetId: agent.id }],
			{ remote: false },
		),
	).toEqual({ status: "missing" });
	expect(
		resolvePresetAgentLink({ agentId: agent.id }, [], { remote: false }),
	).toEqual({ status: "missing" });
	expect(
		resolvePresetAgentLink({ agentId: " " }, [agent], { remote: false }),
	).toEqual({ status: "missing" });
	expect(
		resolvePresetAgentLink(
			{ agentId: "claude" },
			[agent, { ...agent, id: "another" }],
			{ remote: false },
		),
	).toEqual({ status: "ambiguous" });
	expect(
		resolvePresetAgentLink({ agentId: agent.id }, [agent], { remote: true }),
	).toEqual({ status: "remote" });
	expect(resolvePresetAgentLink({}, [agent], { remote: true })).toEqual({
		status: "unlinked",
	});
});

test("snapshots follow live config and normalize only an unambiguous local legacy link", () => {
	const presets = [
		{ id: "linked", agentId: agent.id, commands: ["old"] },
		{ id: "legacy", agentId: "claude", commands: ["old"] },
		{ id: "plain", commands: ["unchanged"] },
	];
	const updated = { ...agent, args: ["--new"], env: { MODE: "work" } };
	const patch = { agentId: agent.id, commands: [getAgentCommandText(updated)] };
	expect(
		syncLinkedPresetSnapshots(presets, updated, [agent], { remote: false }),
	).toEqual([
		{ id: "linked", patch },
		{ id: "legacy", patch },
	]);
	expect(presets[0]?.commands).toEqual(["old"]);
	expect(
		syncLinkedPresetSnapshots(presets, updated, [agent], { remote: true }),
	).toEqual([]);
	expect(
		syncLinkedPresetSnapshots(
			presets.filter((preset) => preset.id === "legacy"),
			updated,
			[agent, { ...agent, id: "second" }],
			{ remote: false },
		),
	).toEqual([]);
});
