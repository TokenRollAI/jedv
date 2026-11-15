import { describe, expect, it } from "bun:test";
import { toAppDisplayName } from "./app-display-name";

describe("toAppDisplayName", () => {
	it("keeps every app name unchanged with the default display name", () => {
		for (const name of ["Jedv", "Jedv Canary", "Jedv (my-branch)"]) {
			expect(toAppDisplayName(name, "Jedv")).toBe(name);
		}
	});

	it("swaps only the product name and keeps the suffix", () => {
		expect(toAppDisplayName("Jedv", "Jedv")).toBe("Jedv");
		expect(toAppDisplayName("Jedv Canary", "Jedv")).toBe("Jedv Canary");
		expect(toAppDisplayName("Jedv (my-branch)", "Jedv")).toBe(
			"Jedv (my-branch)",
		);
	});

	it("leaves a name without the product name alone", () => {
		expect(toAppDisplayName("Electron", "Jedv")).toBe("Electron");
	});
});
