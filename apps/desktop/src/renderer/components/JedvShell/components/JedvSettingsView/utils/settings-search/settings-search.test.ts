import { expect, test } from "bun:test";
import { getVisibleMatchCountBySection } from "./settings-search";

test("local settings search routes daemon and deleted projects to their own sections", () => {
	expect(getVisibleMatchCountBySection("daemon").terminal).toBeGreaterThan(0);
	expect(getVisibleMatchCountBySection("recently deleted").projects).toBe(1);
	expect(
		getVisibleMatchCountBySection("accessibility").permissions,
	).toBeGreaterThan(0);
	expect(getVisibleMatchCountBySection(" ")).toEqual({});
});
