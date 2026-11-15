import { expect, mock, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { isManifestLive } from "../../lib/host/manifest-liveness";
import { stopOwnedHost } from "./stop-host";

const manifest = {
	pid: 42,
	endpoint: "http://127.0.0.1:1",
	authToken: "fixture",
	startedAt: 1,
	organizationId: "jedv-local",
};

test("stop never signals a live PID that belongs to another process", async () => {
	const terminate = mock(async (_pid: number) => {});
	const stopped = await stopOwnedHost(manifest, {
		isLive: (value) =>
			isManifestLive(value, {
				isAlive: () => true,
				inspectCommand: async () => "/usr/bin/unrelated-process",
			}),
		terminate,
	});
	expect(stopped).toBe(false);
	expect(terminate).not.toHaveBeenCalled();
});

test("stop signals only the host whose manifest ownership was verified", async () => {
	const terminate = mock(async (_pid: number) => {});
	const stopped = await stopOwnedHost(manifest, {
		isLive: (value) =>
			isManifestLive(value, {
				isAlive: () => true,
				inspectCommand: async () => "/opt/jedv/bin/jedv-host",
			}),
		terminate,
	});
	expect(stopped).toBe(true);
	expect(terminate.mock.calls).toEqual([[42]]);
});

test("stop recognizes the standalone host after its wrapper execs Node", async () => {
	const hostBinary =
		process.env.JEDV_HOST_BIN ?? join(dirname(process.execPath), "jedv-host");
	const libDir = `${dirname(resolve(hostBinary))}/../lib`;
	const terminate = mock(async (_pid: number) => {});
	const stopped = await stopOwnedHost(manifest, {
		isLive: (value) =>
			isManifestLive(value, {
				isAlive: () => true,
				inspectCommand: async () => `${libDir}/node ${libDir}/host-service.js`,
			}),
		terminate,
	});
	expect(stopped).toBe(true);
	expect(terminate.mock.calls).toEqual([[42]]);
});

test.each([
	"/usr/bin/node /tmp/server.js",
	"/usr/bin/node /tmp/jedv-host/server.js",
	"/opt/jedv/lib/node /tmp/host-service.js",
])("stop never signals an unrelated Node process: %s", async (command) => {
	const terminate = mock(async (_pid: number) => {});
	const probeHealthy = mock(async () => true);
	const stopped = await stopOwnedHost(manifest, {
		isLive: (value) =>
			isManifestLive(value, {
				isAlive: () => true,
				inspectCommand: async () => command,
				probeHealthy,
			}),
		terminate,
	});
	expect(stopped).toBe(false);
	expect(terminate).not.toHaveBeenCalled();
	expect(probeHealthy).not.toHaveBeenCalled();
});
