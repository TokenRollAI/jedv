import { linguiMacroPlugin } from "@jedv/i18n/bun-plugin";

const result = await Bun.build({
	entrypoints: ["scripts/test-support/host-entry.ts"],
	target: "node",
	format: "esm",
	outdir: ".cache/node-fixture",
	naming: "host.mjs",
	plugins: [linguiMacroPlugin],
	external: [
		"better-sqlite3",
		"node-pty",
		"@parcel/watcher",
		"puppeteer-core",
		"chromium-bidi",
	],
});
if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}
console.log("Built isolated Node host fixture with product Lingui compiler");
