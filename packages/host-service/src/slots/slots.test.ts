import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slotManifestSchema } from "@jedv/shared/declarative-slots";
import { networkFixture } from "../peers/test-fixture";

const fixtures: ReturnType<typeof networkFixture>[] = [];
afterEach(async () => {
	for (const f of fixtures.splice(0)) await f.dispose();
});
function fixture() {
	const f = networkFixture();
	fixtures.push(f);
	return f;
}
function manifest() {
	return {
		version: 1,
		id: "build",
		name: "Build",
		slots: [
			{
				target: "teamwork.header",
				items: [{ label: "State", payloadKey: "state" }],
			},
			{
				target: "sidebar.panel",
				cardType: "summary",
				title: "Build status",
				items: [
					{ label: "Count", payloadKey: "count" },
					{ label: "Markup", text: "<script>untrusted text</script>" },
				],
				url: "https://example.com/status",
			},
			{
				target: "mail.provider",
				eventTypeSuffix: "update",
				allowedTo: "leader",
			},
		],
	};
}
function install(f: ReturnType<typeof fixture>) {
	const path = join(f.root, "manifest.json");
	writeFileSync(path, JSON.stringify(manifest()));
	return f.slots.install({ manifestPath: path, bindTeamId: f.teamId });
}
test("only fixed data-only slots and safe external URLs are accepted; arbitrary code, extra fields, duplicate target and oversized text fail", () => {
	for (const target of ["dom", "iframe", "script"])
		expect(() =>
			slotManifestSchema.parse({
				version: 1,
				id: "bad",
				name: "Bad",
				slots: [{ target, script: "code" }],
			}),
		).toThrow();
	for (const url of [
		"javascript:alert(1)",
		"file:///tmp/a",
		"https://u:p@example.com/",
	])
		expect(() =>
			slotManifestSchema.parse({
				version: 1,
				id: "bad",
				name: "Bad",
				slots: [
					{
						target: "sidebar.panel",
						cardType: "summary",
						title: "Title",
						items: [],
						url,
					},
				],
			}),
		).toThrow();
	expect(() =>
		slotManifestSchema.parse({ ...manifest(), script: "code" }),
	).toThrow();
	expect(() =>
		slotManifestSchema.parse({
			...manifest(),
			slots: [manifest().slots[0], manifest().slots[0]],
		}),
	).toThrow();
	expect(() =>
		slotManifestSchema.parse({ ...manifest(), name: "x".repeat(81) }),
	).toThrow();
});
test("provider token is scoped, payload projects only owned scalars, and disable/uninstall revoke old tokens", async () => {
	const f = fixture(),
		installed = await install(f),
		credential = installed.providerToken?.token ?? "";
	const provider = f.peers.authenticateProvider(credential);
	expect(() =>
		f.peers.ingestProvider(provider, {
			idempotencyKey: "bad",
			type: "provider.build.other",
			body: "no",
		}),
	).toThrow("outside extension scope");
	expect(() =>
		f.peers.ingestProvider(provider, {
			idempotencyKey: "bad",
			type: "provider.build.update",
			sourceKind: "human",
		}),
	).toThrow();
	const envelope = {
		idempotencyKey: "one",
		type: "provider.build.update",
		payload: { state: "<b>ready</b>", count: 4, object: { html: "ignored" } },
	};
	f.peers.ingestProvider(provider, envelope);
	expect(f.peers.ingestProvider(provider, envelope).duplicate).toBe(true);
	expect(() =>
		f.peers.ingestProvider(provider, {
			...envelope,
			payload: { state: "different" },
		}),
	).toThrow("different content");
	const view = f.slots.resolveView({
		surface: "sidebar.panel",
		teamId: f.teamId,
	});
	expect(view[0]?.items).toEqual([
		{ label: "Count", text: "4" },
		{ label: "Markup", text: "<script>untrusted text</script>" },
	]);
	expect(
		f.slots.resolveView({ surface: "teamwork.header", teamId: f.teamId })[0]
			?.items[0]?.text,
	).toBe("<b>ready</b>");
	expect(
		f.slots.resolveView({ surface: "sidebar.panel", teamId: "other-team" }),
	).toEqual([]);
	await f.slots.setEnabled({ extensionId: "build", enabled: false });
	expect(() => f.peers.authenticateProvider(credential)).toThrow();
	const enabled = await f.slots.setEnabled({
		extensionId: "build",
		enabled: true,
	});
	const fresh = enabled.providerToken?.token ?? "";
	expect(fresh).not.toBe(credential);
	expect(f.peers.authenticateProvider(fresh).id).toBeTruthy();
	await f.slots.uninstall({ extensionId: "build" });
	expect(() => f.peers.authenticateProvider(fresh)).toThrow();
	expect(f.slots.list()).toEqual([]);
});
test("corrupted manifest configuration preserves evidence and fails closed for extension credentials", async () => {
	const f = fixture(),
		installed = await install(f),
		credential = installed.providerToken?.token ?? "",
		path = join(f.root, "extensions/declarative-slots.json");
	writeFileSync(path, "{broken");
	expect(() => f.slots.list()).toThrow();
	expect(() =>
		f.slots.resolveView({ surface: "sidebar.panel", teamId: f.teamId }),
	).toThrow();
	expect(() => f.peers.authenticateProvider(credential)).toThrow();
	expect(readFileSync(path, "utf8")).toBe("{broken");
});

test("concurrent asynchronous installs admit one manifest and one provider credential", async () => {
	const f = fixture();
	const result = await Promise.allSettled([install(f), install(f)]);
	expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
	expect(result.filter((item) => item.status === "rejected")).toHaveLength(1);
	expect(f.slots.list()).toHaveLength(1);
	expect(f.peers.listProviderTokens()).toHaveLength(1);
});
