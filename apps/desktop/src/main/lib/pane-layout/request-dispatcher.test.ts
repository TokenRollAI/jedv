import { expect, test } from "bun:test";
import {
	type PaneLayoutRendererRequest,
	PaneLayoutRequests,
} from "./request-dispatcher";

const result = {
	paneId: null,
	tabId: null,
	layout: { activeTabId: null, tabs: [] },
};
function fixture() {
	const timers = new Set<() => void>();
	const alive = new Set([1, 2]);
	const requests = new PaneLayoutRequests({
		focusedWindowId: () => 2,
		isAlive: (id) => alive.has(id),
		now: () => 0,
		schedule: (callback) => {
			const timer = () => {
				timers.delete(timer);
				callback();
			};
			timers.add(timer);
			return () => {
				timers.delete(timer);
			};
		},
	});
	const delivered: PaneLayoutRendererRequest[] = [];
	requests.on("request", (request) => delivered.push(request));
	return { requests, delivered, timers, alive };
}
test("local desktop needs no cloud login and targets the window showing the workspace", async () => {
	const { requests, delivered, timers } = fixture();
	const releaseFirst = requests.addSubscriber(1),
		releaseSecond = requests.addSubscriber(2);
	requests.setWorkspace(1, "workspace");
	const pending = requests.request("workspace", { type: "list" });
	expect(delivered).toHaveLength(1);
	expect(delivered[0].targetWebContentsId).toBe(1);
	expect(delivered[0].targetSubscriptionId).toBe(releaseFirst.subscriptionId);
	expect(delivered[0].expiresAt).toBe(10_000);
	requests.respond({ requestId: delivered[0].requestId, result }, 2);
	expect(timers.size).toBe(1);
	requests.respond({ requestId: delivered[0].requestId, result }, 1);
	expect(await pending).toEqual(result);
	expect(timers.size).toBe(0);
	releaseFirst.unsubscribe();
	releaseSecond.unsubscribe();
});
test("target subscriber cleanup rejects requests and duplicate cleanup is harmless", async () => {
	const { requests, timers } = fixture();
	const first = requests.addSubscriber(1),
		second = requests.addSubscriber(1);
	const pending = requests.request("workspace", { type: "list" });
	const rejected = pending.catch((error) => error);
	first.unsubscribe();
	expect((await rejected).message).toContain("connection closed");
	expect(timers.size).toBe(0);
	first.unsubscribe();
	second.unsubscribe();
	await expect(requests.request("workspace", { type: "list" })).rejects.toThrow(
		"No desktop window",
	);
});
test("bounded dispatch and fake-clock expiry never wait on a real timeout", async () => {
	const { requests, delivered, timers, alive } = fixture();
	const release = requests.addSubscriber(1);
	const pending = Array.from({ length: 64 }, () =>
		requests.request("workspace", { type: "list" }),
	);
	const settled = Promise.allSettled(pending);
	await expect(requests.request("workspace", { type: "list" })).rejects.toThrow(
		"Too many pending",
	);
	expect(delivered).toHaveLength(64);
	for (const expire of [...timers]) expire();
	expect((await settled).every((row) => row.status === "rejected")).toBe(true);
	expect(timers.size).toBe(0);
	alive.clear();
	await expect(requests.request("workspace", { type: "list" })).rejects.toThrow(
		"No desktop window",
	);
	release.unsubscribe();
});
