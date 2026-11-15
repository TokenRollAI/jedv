import { expect, test } from "bun:test";
import { JEDV_RELEASES_URL, JEDV_UPDATE_FEED_URL } from "shared/jedv";
import config from "../../../../electron-builder";
import pkg from "../../../../package.json";

test("packaging declares Jedv generic update metadata while build commands never publish", () => {
	expect(pkg.repository.url).toBe("https://github.com/TokenRollAI/jedv.git");
	expect(JEDV_RELEASES_URL).toBe(
		"https://github.com/TokenRollAI/jedv/releases",
	);
	expect(config.publish).toEqual({
		provider: "generic",
		url: JEDV_UPDATE_FEED_URL,
	});
	expect(config.mac?.target).toBe("default");
	expect(config.mac?.hardenedRuntime).toBe(true);
	expect(config.mac?.notarize).toBe(true);
	expect(pkg.scripts.build).toContain("--publish never");
	expect(pkg.scripts.release).toContain("--publish never");
	expect(pkg.scripts.package).toContain("--publish never");
});
