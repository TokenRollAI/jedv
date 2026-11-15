import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { networkFixture } from "../peers/test-fixture";
import { registerMobileHttp } from "./http";
import { MOBILE_SESSION_TTL, PAIR_TTL } from "./service";

const fixtures: ReturnType<typeof networkFixture>[] = [];
afterEach(async () => {
	for (const f of fixtures.splice(0)) await f.dispose();
});
function fixture() {
	const f = networkFixture();
	fixtures.push(f);
	return f;
}
const endpoint = "http://127.0.0.1:4811";
const remote = "https://host-a.tailnet.ts.net";
function surface() {
	const f = fixture(),
		app = new Hono();
	registerMobileHttp(app, f.ctx, f.mobile);
	return { ...f, app };
}
async function pair(f: ReturnType<typeof surface>, origin = endpoint) {
	const { code } = f.mobile.createPairingCode();
	const response = await f.app.request(`${endpoint}/mobile/api/pair`, {
		method: "POST",
		headers: { Origin: origin, "Content-Type": "application/json" },
		body: JSON.stringify({ code, label: "Phone" }),
	});
	return {
		response,
		data: (await response.json()) as {
			sessionId: string;
			csrfToken: string;
			expiresAt: number;
		},
		cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
	};
}
test("pairing codes are single-use, expire, are only stored hashed, and session TTL/revoke are immediate", () => {
	const f = fixture(),
		issued = f.mobile.createPairingCode();
	expect(
		JSON.stringify(
			f.sqlite.prepare("SELECT * FROM mobile_pairing_codes").all(),
		),
	).not.toContain(issued.code);
	const paired = f.mobile.pair({ code: issued.code });
	expect(f.mobile.authenticate(paired.sessionToken).id).toBe(
		paired.session.sessionId,
	);
	expect(() => f.mobile.pair({ code: issued.code })).toThrow(
		"Invalid or expired",
	);
	expect(JSON.stringify(f.mobile.listSessions())).not.toContain(
		paired.sessionToken,
	);
	expect(JSON.stringify(f.mobile.listSessions())).not.toContain(
		paired.session.csrfToken,
	);
	f.mobile.revokeSession(paired.session.sessionId);
	expect(() => f.mobile.authenticate(paired.sessionToken)).toThrow();
	const expired = f.mobile.createPairingCode();
	f.advance(PAIR_TTL);
	expect(() => f.mobile.pair({ code: expired.code }, "next")).toThrow();
	const current = f.mobile.pair(
		{ code: f.mobile.createPairingCode().code },
		"next2",
	);
	f.advance(MOBILE_SESSION_TTL);
	expect(() => f.mobile.authenticate(current.sessionToken)).toThrow();
});
test("pair attempts are bounded per socket identity, active codes stay bounded, and rate window uses a controlled clock", () => {
	const f = fixture();
	for (let n = 0; n < 6; n++) f.mobile.createPairingCode();
	expect(
		f.sqlite.prepare("SELECT count(*) AS n FROM mobile_pairing_codes").get(),
	).toEqual({ n: 3 });
	for (let n = 0; n < 10; n++)
		expect(() => f.mobile.pair({ code: "WRONG" }, "socket-ip")).toThrow();
	expect(() =>
		f.mobile.pair({ code: f.mobile.createPairingCode().code }, "socket-ip"),
	).toThrow("Too many pairing");
	f.advance(60_000);
	expect(
		f.mobile.pair({ code: f.mobile.createPairingCode().code }, "socket-ip")
			.session.sessionId,
	).toBeTruthy();
});
test("configured remote Origin supports actual loopback HTTP Serve, sets Secure cookie, and changes atomically revoke sessions", async () => {
	const f = surface();
	for (const origin of [
		"http://a.ts.net",
		"http://127.0.0.1:123",
		"https://example.com",
		"https://a.ts.net/mobile",
	])
		expect(() => f.mobile.setOrigin({ origin })).toThrow();
	const code = f.mobile.createPairingCode().code;
	const rejected = await f.app.request(`${endpoint}/mobile/api/pair`, {
		method: "POST",
		headers: {
			Origin: remote,
			"X-Forwarded-Proto": "https",
			"X-Forwarded-Host": "host-a.tailnet.ts.net",
		},
		body: JSON.stringify({ code }),
	});
	expect(rejected.status).toBe(403);
	expect(f.mobile.setOrigin({ origin: remote })).toEqual({
		origin: remote,
		mobileUrl: `${remote}/mobile`,
		revokedSessions: true,
	});
	const paired = await pair(f, remote);
	expect(paired.response.status).toBe(200);
	expect(
		(
			await f.app.request(`${endpoint}/mobile/api/logout`, {
				method: "POST",
				headers: {
					Origin: endpoint,
					Cookie: paired.cookie,
					"x-jedv-mobile-csrf": paired.data.csrfToken,
				},
			})
		).status,
	).toBe(403);
	const cookie = paired.response.headers.get("set-cookie") ?? "";
	for (const flag of ["Secure", "HttpOnly", "SameSite=Strict", "Path=/mobile"])
		expect(cookie).toContain(flag);
	expect(
		(
			await f.app.request(`${endpoint}/mobile/api/session`, {
				headers: { Cookie: paired.cookie, Origin: remote },
			})
		).status,
	).toBe(200);
	expect(f.mobile.setOrigin({ origin: remote }).revokedSessions).toBe(false);
	expect(
		(
			await f.app.request(`${endpoint}/mobile/api/session`, {
				headers: { Cookie: paired.cookie },
			})
		).status,
	).toBe(200);
	f.mobile.setOrigin({ origin: null });
	const revoked = await f.app.request(`${endpoint}/mobile/api/session`, {
		headers: { Cookie: paired.cookie },
	});
	expect(revoked.status).toBe(401);
	expect(revoked.headers.get("set-cookie")).toContain("Secure");
});
test("mutation whitelist requires Origin/CSRF and rejects cross-site Fetch Metadata without trusting forwarded headers", async () => {
	const f = surface(),
		paired = await pair(f);
	expect(paired.response.status).toBe(200);
	expect(paired.response.headers.get("set-cookie")).not.toContain("Secure;");
	const request = (path: string, headers: Record<string, string>) =>
		f.app.request(`${endpoint}${path}`, {
			method: "POST",
			headers: {
				Cookie: paired.cookie,
				"Content-Type": "application/json",
				...headers,
			},
			body: "{}",
		});
	expect((await request("/mobile/api/logout", {})).status).toBe(403);
	expect(
		(await request("/mobile/api/logout", { Origin: endpoint })).status,
	).toBe(403);
	expect(
		(
			await request("/mobile/api/logout", {
				Origin: "https://evil.ts.net",
				"x-jedv-mobile-csrf": paired.data.csrfToken,
			})
		).status,
	).toBe(403);
	expect(
		(
			await request("/mobile/api/logout", {
				Origin: endpoint,
				"Sec-Fetch-Site": "cross-site",
				"x-jedv-mobile-csrf": paired.data.csrfToken,
			})
		).status,
	).toBe(403);
	expect(
		(
			await request("/mobile/api/terminal/write", {
				Origin: endpoint,
				"x-jedv-mobile-csrf": paired.data.csrfToken,
			})
		).status,
	).toBe(404);
	const result = await request("/mobile/api/logout", {
		Origin: endpoint,
		"x-jedv-mobile-csrf": paired.data.csrfToken,
	});
	expect(result.status).toBe(200);
	expect(
		(
			await f.app.request(`${endpoint}/mobile/api/session`, {
				headers: { Cookie: paired.cookie },
			})
		).status,
	).toBe(401);
});
