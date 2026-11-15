import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import {
	decodeMuxFrame,
	encodeData,
	encodeHello,
	encodeOpened,
	encodeWindow,
	MuxFrameType,
} from "@jedv/shared/port-forward-mux";
import { WebSocketServer } from "ws";
import { registerForwardMuxRoute } from "../../../../../../packages/host-service/src/ports/forward-mux-route.ts";
import { PskHostAuthProvider } from "../../../../../../packages/host-service/src/providers/host-auth/PskHostAuthProvider/PskHostAuthProvider.ts";
import {
	DirectForwardTransport,
	type DirectForwardTransportOptions,
} from "./direct-forward-transport";
import { PortForwardManager } from "./port-forward-manager";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function transportFor(
	baseUrl: string,
	options: Partial<DirectForwardTransportOptions> = {},
) {
	const transport = new DirectForwardTransport({
		resolveEndpoint: () => ({ baseUrl, token: "host-secret" }),
		...options,
	});
	cleanups.push(() => transport.closeAll());
	return transport;
}

function target(baseUrl: string, remotePort = 3000) {
	return { hostUrl: baseUrl, workspaceId: "owner & workspace", remotePort };
}

async function listen(server: net.Server): Promise<number> {
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return (server.address() as net.AddressInfo).port;
}

async function echo(stream: Duplex, payload: string): Promise<string> {
	const response = once(stream, "data");
	stream.write(payload);
	const [chunk] = await response;
	return chunk.toString();
}

async function miniHost(
	options: { skipHello?: boolean; skipOpen?: boolean; status?: number } = {},
	server: http.Server | https.Server = http.createServer(),
) {
	const wss = new WebSocketServer({ noServer: true });
	const events = new EventEmitter();
	let connections = 0;
	const requests: http.IncomingMessage[] = [];
	server.on("upgrade", (request, socket, head) => {
		requests.push(request);
		if (options.status) {
			socket.end(
				`HTTP/1.1 ${options.status} Refused\r\nConnection: close\r\n\r\n`,
			);
			return;
		}
		wss.handleUpgrade(request, socket, head, (ws) => {
			connections++;
			wss.emit("connection", ws, request);
			if (!options.skipHello) ws.send(encodeHello());
			ws.on("message", (raw) => {
				const frame = decodeMuxFrame(Buffer.from(raw as Buffer));
				if (!frame) return;
				if (frame.type === MuxFrameType.open) {
					if (!options.skipOpen) ws.send(encodeOpened(frame.streamId));
					events.emit("openFrame", frame.streamId);
				}
				if (frame.type === MuxFrameType.close) {
					events.emit("closeFrame", frame.streamId);
				}
				if (frame.type === MuxFrameType.data) {
					ws.send(encodeWindow(frame.streamId, frame.payload.byteLength));
					ws.send(encodeData(frame.streamId, frame.payload));
				}
			});
		});
	});
	const port = await listen(server);
	cleanups.push(async () => {
		for (const ws of wss.clients) ws.terminate();
		wss.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return {
		baseUrl: `${server instanceof https.Server ? "https" : "http"}://127.0.0.1:${port}`,
		requests,
		options,
		events,
		wss,
		connections: () => connections,
	};
}

test("the real host /fwd route authenticates, checks ownership and forwards through a loopback manager", async () => {
	const echoSockets = new Set<net.Socket>();
	const echoServer = net.createServer((socket) => {
		echoSockets.add(socket);
		socket.on("close", () => echoSockets.delete(socket));
		socket.pipe(socket);
	});
	const echoPort = await listen(echoServer);
	cleanups.push(async () => {
		for (const socket of echoSockets) socket.destroy();
		await new Promise<void>((resolve) => echoServer.close(() => resolve()));
	});

	const hostServiceRequire = createRequire(
		new URL(
			"../../../../../../packages/host-service/package.json",
			import.meta.url,
		),
	);
	const { Hono } = hostServiceRequire("hono");
	const { createNodeWebSocket } = hostServiceRequire("@hono/node-ws");
	const app: Parameters<typeof registerForwardMuxRoute>[0]["app"] = new Hono();
	const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
	const auth = new PskHostAuthProvider("host-secret");
	app.use("/fwd", async (c, next) => {
		if (!auth.validate(c.req.raw))
			return c.json({ error: "Unauthorized" }, 401);
		return next();
	});
	registerForwardMuxRoute({
		app,
		upgradeWebSocket,
		getPortsByWorkspace: (workspaceId) =>
			workspaceId === "owner & workspace"
				? [
						{
							port: echoPort,
							address: "127.0.0.1",
							pid: 1,
							processName: "echo",
							terminalId: "test",
							workspaceId,
							detectedAt: 0,
						},
					]
				: [],
	});
	const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
	injectWebSocket(server);
	await once(server, "listening");
	const baseUrl = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
	cleanups.push(
		() => new Promise<void>((resolve) => server.close(() => resolve())),
	);
	let token = "wrong";
	const transport = transportFor(baseUrl, {
		resolveEndpoint: () => ({ baseUrl, token }),
	});
	await assert.rejects(
		transport.probe(target(baseUrl)),
		/rejected the credential/,
	);
	token = "host-secret";
	await transport.probe(target(baseUrl));
	await assert.rejects(
		transport.openStream(
			target(baseUrl, echoPort === 65535 ? 1 : echoPort + 1),
		),
		/port not owned by workspace/,
	);
	await assert.rejects(
		transport.openStream({
			...target(baseUrl, echoPort),
			workspaceId: "other",
		}),
		/port not owned by workspace/,
	);
	const manager = new PortForwardManager({
		transport,
		getLocalPorts: () => [],
		killLocalPort: async () => ({ success: true }),
		canBindPort: async () => true,
	});
	cleanups.push(() => manager.stopAll());
	const [forward] = await manager.forward(target(baseUrl, echoPort));
	assert.equal(forward.transport, "direct");
	assert.equal(forward.status.state, "active");
	assert.ok(forward.localPort);
	const entries = (
		manager as unknown as {
			entries: Map<string, { server: net.Server }>;
		}
	).entries;
	const address = entries.get(forward.id)?.server.address() as net.AddressInfo;
	assert.equal(address.address, "127.0.0.1");
	const socket = net.connect({ host: "127.0.0.1", port: forward.localPort });
	await once(socket, "connect");
	assert.equal(await echo(socket, "real host contract"), "real host contract");
	socket.destroy();
});

test("Bearer credentials stay out of URLs, sessions multiplex and rotation redials", async () => {
	const host = await miniHost();
	let token = "host-secret";
	const transport = transportFor(host.baseUrl, {
		resolveEndpoint: () => ({ baseUrl: host.baseUrl, token }),
	});
	const a = await transport.openStream(target("https://logical.invalid"));
	a.on("error", () => {});
	const b = await transport.openStream(target("https://logical.invalid", 4000));
	b.on("error", () => {});
	assert.equal(host.connections(), 1);
	assert.equal(host.requests[0].headers.authorization, "Bearer host-secret");
	assert.equal(host.requests[0].url, "/fwd?workspaceId=owner+%26+workspace");
	assert.equal(await echo(a, "first"), "first");
	assert.equal(await echo(b, "second"), "second");
	token = "rotated-secret";
	const c = await transport.openStream(target(host.baseUrl));
	c.on("error", () => {});
	assert.equal(host.connections(), 2);
	assert.equal(a.destroyed, true);
	assert.equal(host.requests[1].headers.authorization, "Bearer rotated-secret");
});

test("cancelling one HELLO waiter preserves another; closeAll rejects pending readiness", async () => {
	const host = await miniHost({ skipHello: true });
	const transport = transportFor(host.baseUrl);
	const controller = new AbortController();
	const cancelled = transport.probe(target(host.baseUrl), {
		signal: controller.signal,
	});
	const survivor = transport.probe(target(host.baseUrl));
	controller.abort();
	await assert.rejects(cancelled, { name: "AbortError" });
	while (!host.wss.clients.size) await once(host.wss, "connection");
	for (const ws of host.wss.clients) ws.send(encodeHello());
	await survivor;
	assert.equal(host.connections(), 1);
	transport.closeAll();
	const pending = transport.probe(target(host.baseUrl));
	transport.closeAll();
	await assert.rejects(pending, /Forward tunnel closed/);
});

test("aborting a pending OPEN sends CLOSE and leaves other streams usable", async () => {
	const host = await miniHost();
	const transport = transportFor(host.baseUrl);
	const live = await transport.openStream(target(host.baseUrl));
	live.on("error", () => {});
	host.options.skipOpen = true;
	const opened = once(host.events, "openFrame");
	const closed = once(host.events, "closeFrame");
	const controller = new AbortController();
	const pending = transport.openStream(target(host.baseUrl, 4000), {
		signal: controller.signal,
	});
	const [streamId] = await opened;
	controller.abort();
	await assert.rejects(pending, { name: "AbortError" });
	assert.deepEqual(await closed, [streamId]);
	assert.equal(await echo(live, "survived"), "survived");
});

test("short HELLO and OPEN deadlines evict failed sessions and release host streams", async () => {
	const host = await miniHost({ skipHello: true });
	const transport = transportFor(host.baseUrl, {
		helloTimeoutMs: 20,
		openTimeoutMs: 20,
	});
	await assert.rejects(
		transport.probe(target(host.baseUrl)),
		/Host did not answer/,
	);
	host.options.skipHello = false;
	await transport.probe(target(host.baseUrl));
	assert.equal(host.connections(), 2);
	host.options.skipOpen = true;
	const closed = once(host.events, "closeFrame");
	await assert.rejects(
		transport.openStream(target(host.baseUrl)),
		/Host did not answer/,
	);
	await closed;
	host.options.skipOpen = false;
	const stream = await transport.openStream(target(host.baseUrl));
	stream.on("error", () => {});
	assert.equal(await echo(stream, "recovered"), "recovered");
});

test("closeAll rejects pending OPENs and the next request creates a fresh session", async () => {
	const host = await miniHost({ skipOpen: true });
	const transport = transportFor(host.baseUrl);
	const opened = once(host.events, "openFrame");
	const pending = transport.openStream(target(host.baseUrl));
	await opened;
	transport.closeAll();
	await assert.rejects(pending, /Forward tunnel closed/);
	host.options.skipOpen = false;
	const stream = await transport.openStream(target(host.baseUrl));
	stream.on("error", () => {});
	assert.equal(host.connections(), 2);
	assert.equal(await echo(stream, "fresh"), "fresh");
});

test("upgrade errors name the direct endpoint and redirects are refused", async () => {
	for (const status of [401, 403, 404, 302]) {
		const host = await miniHost({ status });
		const transport = transportFor(host.baseUrl);
		await assert.rejects(
			transport.probe(target(host.baseUrl)),
			(error: Error) => {
				assert.match(error.message, /[Dd]irect host/);
				assert.doesNotMatch(error.message, /host-secret|Relay/);
				return true;
			},
		);
		assert.equal(host.requests.length, 1);
	}
});

test("TLS rejects an untrusted certificate, accepts an explicit CA and checks hostnames", async () => {
	const dir = await mkdtemp(join(tmpdir(), "jedv-forward-tls-"));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const keyPath = join(dir, "key.pem");
	const certPath = join(dir, "cert.pem");
	await promisify(execFile)("openssl", [
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"1",
		"-subj",
		"/CN=localhost",
		"-addext",
		"subjectAltName=DNS:localhost",
		"-keyout",
		keyPath,
		"-out",
		certPath,
	]);
	const [key, cert] = await Promise.all([
		readFile(keyPath),
		readFile(certPath),
	]);
	const host = await miniHost({}, https.createServer({ key, cert }));
	const untrusted = transportFor(
		host.baseUrl.replace("127.0.0.1", "localhost"),
	);
	await assert.rejects(
		untrusted.probe(target(host.baseUrl)),
		/self.signed certificate/i,
	);
	const mismatch = transportFor(host.baseUrl, {
		resolveEndpoint: () => ({
			baseUrl: host.baseUrl,
			token: "host-secret",
			ca: cert,
		}),
	});
	await assert.rejects(
		mismatch.probe(target(host.baseUrl)),
		/IP|hostname|altnames/i,
	);
	const trusted = transportFor(host.baseUrl, {
		resolveEndpoint: () => ({
			baseUrl: host.baseUrl.replace("127.0.0.1", "localhost"),
			token: "host-secret",
			ca: cert,
		}),
	});
	const stream = await trusted.openStream(target(host.baseUrl));
	stream.on("error", () => {});
	assert.equal(await echo(stream, "verified TLS"), "verified TLS");
});

test("disconnecting one private host closes its streams and keeps another host usable", async () => {
	const a = await miniHost();
	const b = await miniHost();
	const transport = transportFor(a.baseUrl, {
		resolveEndpoint: (target) => ({
			baseUrl: target.hostUrl,
			token: "host-secret",
		}),
	});
	const first = await transport.openStream(target(a.baseUrl));
	first.on("error", () => {});
	const second = await transport.openStream(target(b.baseUrl));
	second.on("error", () => {});
	transport.closeHost(a.baseUrl);
	assert.equal(first.destroyed, true);
	assert.equal(await echo(second, "still connected"), "still connected");
});
