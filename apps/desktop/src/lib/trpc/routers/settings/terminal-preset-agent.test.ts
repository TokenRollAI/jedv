import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { terminalPresetSchema } from "@jedv/local-db/schema/zod";
import {
	applyTerminalPresetAgent,
	terminalPresetAgentInput,
} from "./terminal-preset-agent";

const agentId = "00000000-0000-4000-8000-000000000001";
const preset = { id: "preset", name: "CLI", cwd: "", commands: ["claude"] };

test("agent association survives the real SQLite JSON column roundtrip and nullable clear removes the key", () => {
	const db = new Database(":memory:");
	try {
		db.exec(
			"CREATE TABLE settings (id INTEGER PRIMARY KEY, terminal_presets TEXT)",
		);
		const write = (value: unknown) =>
			db
				.query("INSERT OR REPLACE INTO settings VALUES (1, ?)")
				.run(JSON.stringify(value));
		const read = () =>
			terminalPresetSchema
				.array()
				.parse(
					JSON.parse(
						(
							db
								.query("SELECT terminal_presets FROM settings WHERE id = 1")
								.get() as { terminal_presets: string }
						).terminal_presets,
					),
				);
		write([
			applyTerminalPresetAgent(preset, terminalPresetAgentInput.parse(agentId)),
		]);
		expect(read()[0]?.agentId).toBe(agentId);
		const persisted = read()[0];
		if (!persisted) throw new Error("Missing persisted preset");
		write([
			applyTerminalPresetAgent(persisted, terminalPresetAgentInput.parse(null)),
		]);
		expect(read()[0]).not.toHaveProperty("agentId");
		expect(read()[0]?.commands).toEqual(preset.commands);
	} finally {
		db.close();
	}
});

test("omitted association preserves existing and legacy presets while new writes require a UUID", () => {
	expect(applyTerminalPresetAgent({ ...preset, agentId }, undefined)).toEqual({
		...preset,
		agentId,
	});
	expect(applyTerminalPresetAgent(preset, undefined)).toBe(preset);
	expect(terminalPresetAgentInput.safeParse("claude").success).toBe(false);
	expect(
		terminalPresetSchema.parse({ ...preset, agentId: "claude" }).agentId,
	).toBe("claude");
});
