import { expect, test } from "bun:test";
import {
	TEAM_MAIL_DRAFT_LIMIT,
	TEAM_MAIL_DRAFT_TTL,
	TeamMailDraftStore,
} from "./team-mail-drafts";

test("drafts and retry identities are isolated by logical Host and Team", () => {
	const store = new TeamMailDraftStore();
	const first = { hostId: "local:jedv-local", teamId: "same-team" };
	const otherHost = { ...first, hostId: "private:https://other.ts.net" };
	const otherTeam = { ...first, teamId: "other-team" };
	store.edit(first, { to: "worker", body: "  preserve\n    verbatim  " });
	const request = store.begin(first);
	expect(request?.key).toBeString();
	if (!request) throw new Error("Missing request");
	store.settle(first, request, false);
	expect(store.read(first).request).toBe(request);
	expect(store.read(otherHost).body).toBe("");
	expect(store.read(otherHost).request).toBeNull();
	expect(store.read(otherTeam).body).toBe("");
	expect(store.begin(first)).toBe(request);
	store.settle(first, request, true);
	expect(store.read(first).body).toBe("");
	expect(store.read(first).request).toBeNull();
	expect(store.read(first).to).toBe("worker");
});

test("capacity rejects a new dirty scope without evicting existing instructions; empty drafts are reusable", () => {
	const store = new TeamMailDraftStore();
	for (let id = 0; id < TEAM_MAIL_DRAFT_LIMIT; id++)
		expect(
			store.edit(
				{ hostId: "local", teamId: String(id) },
				{ body: `draft ${id}` },
			),
		).toBe(true);
	const extra = { hostId: "local", teamId: "extra" };
	expect(store.edit(extra, { body: "no capacity" })).toBe(false);
	expect(store.size).toBe(TEAM_MAIL_DRAFT_LIMIT);
	expect(store.read({ hostId: "local", teamId: "0" }).body).toBe("draft 0");
	store.edit({ hostId: "local", teamId: "0" }, { body: "" });
	expect(store.edit(extra, { body: "available" })).toBe(true);
	expect(store.size).toBe(TEAM_MAIL_DRAFT_LIMIT);
});

test("TTL and authoritative Host reconciliation clean entries without resurrecting a removed in-flight draft", () => {
	let now = 0;
	const store = new TeamMailDraftStore(() => now);
	const first = { hostId: "local", teamId: "first" };
	const pending = { hostId: "local", teamId: "pending" };
	const remote = { hostId: "private:other", teamId: "first" };
	store.edit(first, { body: "expires" });
	store.edit(pending, { body: "in flight" });
	store.edit(remote, { body: "other host" });
	const request = store.begin(pending);
	if (!request) throw new Error("Missing request");
	now += TEAM_MAIL_DRAFT_TTL;
	store.sweep();
	expect(store.read(first).body).toBe("");
	expect(store.read(pending).request).toBe(request);
	expect(store.size).toBe(1);
	store.edit(remote, { body: "keep remote" });
	store.reconcile("local", new Set());
	store.settle(pending, request, false);
	expect(store.read(pending).body).toBe("");
	expect(store.read(remote).body).toBe("keep remote");
	store.clear();
	expect(store.size).toBe(0);
});

test("delivery mode and required ACK belong to the durable retry identity", () => {
	const store = new TeamMailDraftStore();
	const scope = { hostId: "host", teamId: "team" };
	store.edit(scope, { body: "urgent work" });
	const queued = store.begin(scope, true);
	if (!queued) throw new Error("Missing request");
	expect(queued.options).toEqual({ deliveryMode: "queue", requiresAck: true });
	store.settle(scope, queued, false);
	expect(store.begin(scope, true)).toBe(queued);
	store.settle(scope, queued, false);
	store.edit(scope, { deliveryMode: "interrupt" });
	const urgent = store.begin(scope, true);
	expect(urgent?.options).toEqual({
		deliveryMode: "interrupt",
		requiresAck: true,
	});
	expect(urgent?.key).not.toBe(queued.key);
});
