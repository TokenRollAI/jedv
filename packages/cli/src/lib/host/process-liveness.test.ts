import { expect, test } from "bun:test";
import { type HostServiceManifest, isProcessAlive } from "./manifest";
import { isManifestLive } from "./manifest-liveness";

const manifest: HostServiceManifest = {
	pid: 42,
	endpoint: "http://127.0.0.1:1",
	authToken: "fixture-token",
	startedAt: 0,
	organizationId: "fixture",
};

function deniedProbe(pid: number, signal: 0): never {
	expect(pid).toBe(manifest.pid);
	expect(signal).toBe(0);
	throw Object.assign(new Error("Permission denied"), { code: "EPERM" });
}

test("a sandbox signal denial does not declare a live host dead", () => {
	expect(isProcessAlive(manifest.pid, deniedProbe)).toBe(true);
	expect(isProcessAlive(process.pid)).toBe(true);
});

test.each([
	"ESRCH",
	"EINVAL",
	undefined,
])("other probe failures do not establish liveness: %s", (code) => {
	expect(
		isProcessAlive(manifest.pid, () => {
			throw Object.assign(new Error("Probe failed"), { code });
		}),
	).toBe(false);
});

test("a denied signal still requires manifest ownership", async () => {
	const live = await isManifestLive(manifest, {
		isAlive: (pid) => isProcessAlive(pid, deniedProbe),
		inspectCommand: async () => "/usr/bin/unrelated",
		inspectExecutable: async () => "/usr/bin/unrelated",
		probeHealthy: async () => {
			throw new Error("A known unrelated owner must never fall back to HTTP");
		},
	});
	expect(live).toBe(false);
});

test.each([
	true,
	false,
])("unreadable identity after EPERM requires authenticated health: %s", async (healthy) => {
	let probes = 0;
	const live = await isManifestLive(manifest, {
		isAlive: (pid) => isProcessAlive(pid, deniedProbe),
		inspectCommand: async () => null,
		probeHealthy: async (endpoint, authToken) => {
			probes++;
			expect(endpoint).toBe(manifest.endpoint);
			expect(authToken).toBe(manifest.authToken);
			return healthy;
		},
	});
	expect(live).toBe(healthy);
	expect(probes).toBe(1);
});
