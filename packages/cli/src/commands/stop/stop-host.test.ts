import { expect, mock, test } from "bun:test";
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
