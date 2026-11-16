import { afterEach, expect, test } from "bun:test";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { ForwardTokens } from "../../../../main/lib/port-forward/forward-tokens";
import { connectPrivateHost } from "./connect-private-host";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

function fixture() {
	const tokens = new ForwardTokens();
	let block: (() => Promise<void>) | undefined;
	const machineIds: Array<string | null> = [];
	const t = initTRPC.context<{ request: Request }>().create({
		transformer: superjson,
	});
	const router = t.router({
		workspace: t.router({
			list: t.procedure.query(async ({ ctx }) => {
				if (ctx.request.headers.get("Authorization") !== "Bearer valid-psk")
					throw new TRPCError({ code: "UNAUTHORIZED" });
				machineIds.push(ctx.request.headers.get("x-jedv-client-machine-id"));
				const waiting = block;
				block = undefined;
				await waiting?.();
				return [];
			}),
		}),
	});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) =>
			fetchRequestHandler({
				endpoint: "/trpc",
				req: request,
				router,
				createContext: () => ({ request }),
			}),
	});
	servers.push(server);
	const origin = `http://127.0.0.1:${server.port}`;
	return {
		tokens,
		origin,
		machineIds,
		connect: (token = "valid-psk") =>
			connectPrivateHost(
				{ baseUrl: `${origin}/`, token },
				{
					machineId: "isolated-machine",
					beginConnection: (url) => tokens.beginPrivateConnection(url),
				},
			),
		blockNext: () => {
			const entered = gate();
			const finish = gate();
			block = async () => {
				entered.release();
				await finish.promise;
			};
			return { entered: entered.promise, finish: finish.release };
		},
	};
}

test("a real authenticated loopback private host becomes navigable only after workspace handshake", async () => {
	const f = fixture();
	const blocked = f.blockNext();
	const connecting = f.connect();
	await blocked.entered;
	expect(f.tokens.hostTokenFor(f.origin)).toBeNull();
	expect(f.tokens.hasHostConnection(f.origin, [])).toBe(false);
	blocked.finish();
	expect(await connecting).toEqual({
		baseUrl: f.origin,
		machineId: "isolated-machine",
	});
	expect(f.machineIds).toEqual(["isolated-machine"]);
	expect(f.tokens.hasHostConnection(f.origin, [])).toBe(true);
	f.tokens.setHostToken(f.origin, null);
	expect(f.tokens.hasHostConnection(f.origin, [])).toBe(false);
});

test("an invalid replacement PSK cannot retain a previous private grant", async () => {
	const f = fixture();
	await f.connect();
	await expect(f.connect("invalid-psk")).rejects.toThrow(
		"Private host connection failed",
	);
	expect(f.tokens.hostTokenFor(f.origin)).toBeNull();
	expect(f.tokens.hasHostConnection(f.origin, [])).toBe(false);
});

for (const revoke of [
	"disconnect",
	"clear",
	"coordinator",
	"new-handshake",
] as const) {
	test(`a late successful handshake cannot undo ${revoke}`, async () => {
		const f = fixture();
		const blocked = f.blockNext();
		const connecting = f.connect().catch((error: unknown) => error);
		await blocked.entered;
		if (revoke === "disconnect") f.tokens.setHostToken(f.origin, null);
		if (revoke === "clear") f.tokens.clearCredentials();
		if (revoke === "coordinator")
			f.tokens.setHostToken(f.origin, "coordinator-psk");
		if (revoke === "new-handshake") await f.connect();
		blocked.finish();
		expect(await connecting).toMatchObject({ code: "BAD_REQUEST" });
		expect(f.tokens.hasHostConnection(f.origin, [])).toBe(
			revoke === "new-handshake",
		);
		expect(f.tokens.hostTokenFor(f.origin)).toBe(
			revoke === "new-handshake"
				? "valid-psk"
				: revoke === "coordinator"
					? "coordinator-psk"
					: null,
		);
	});
}
