import { expect, test } from "bun:test";
import { Hono } from "hono";
import { butlerFixture } from "../butler/test-fixture";
import { registerMobileHttp } from "./http";
import { MOBILE_SESSION_TTL, MobileAuthService } from "./service";

function barrier() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
for (const invalidation of ["revoke", "expire", "origin"] as const)
	for (const operation of ["resolve", "send", "read", "ignore"] as const) {
		test(`${operation} rechecks ${invalidation} after the gated request body, before any real mutation`, async () => {
			const f = butlerFixture();
			let now = 1_000_000;
			let streamController:
				| ReadableStreamDefaultController<Uint8Array>
				| undefined;
			try {
				f.ctx.runtime.butler = f.service;
				const memory = f.memory.runtime.memory.put({
						scopeKind: "global",
						title: "Isolated race fixture",
						content: "No real profile data",
					}),
					card = f.service.requestApproval({
						requestId: "race-approval",
						humanText: "Retire the temporary memory after approval",
						action: { actionType: "deleteMemoryBatch", memoryIds: [memory.id] },
					});
				f.sqlite
					.prepare(
						"INSERT INTO watchdog_alerts(id,dedupe_key,group_key,kind,severity,subject,body,created_at) VALUES('race-alert','race-event','automation_failed:fixture','automation_failed','high','Fixture','Observed fixture failure',1)",
					)
					.run();
				const auth = new MobileAuthService(f.sqlite, () => now),
					paired = auth.pair({ code: auth.createPairingCode().code }),
					app = new Hono();
				registerMobileHttp(app, f.ctx, auth);
				const checked = barrier(),
					authenticate = auth.authenticate.bind(auth);
				auth.authenticate = (raw) => {
					const session = authenticate(raw);
					checked.resolve();
					return session;
				};
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						streamController = controller;
					},
				});
				const path =
					operation === "resolve"
						? `/approvals/${card.id}/resolve`
						: operation === "send"
							? "/butler/send"
							: `/attention/${operation}`;
				const body = JSON.stringify(
					operation === "resolve"
						? { payloadHash: card.payloadHash, decision: "approve" }
						: operation === "send"
							? {
									requestId: "must-not-be-admitted",
									humanText: "Do not accept this revoked request",
								}
							: { groupKey: "automation_failed:fixture" },
				);
				const request = new Request(`http://127.0.0.1:4811/mobile/api${path}`, {
					method: "POST",
					headers: {
						Origin: "http://127.0.0.1:4811",
						Cookie: `jedv_mobile=${paired.sessionToken}`,
						"x-jedv-mobile-csrf": paired.session.csrfToken,
						"Content-Type": "application/json",
						"Content-Length": String(Buffer.byteLength(body)),
					},
					body: stream,
					duplex: "half",
				} as RequestInit);
				const pending = app.fetch(request);
				await checked.promise;
				if (invalidation === "revoke")
					auth.revokeSession(paired.session.sessionId);
				else if (invalidation === "expire") now += MOBILE_SESSION_TTL;
				else auth.setOrigin({ origin: "https://changed.tailnet.ts.net" });
				streamController?.enqueue(new TextEncoder().encode(body));
				streamController?.close();
				streamController = undefined;
				const response = await pending;
				expect(response.status).toBe(401);
				expect(response.headers.get("set-cookie")).toContain("jedv_mobile=");
				expect(
					f.service
						.listApprovals({ status: "all" })
						.find((item) => item.id === card.id)?.status,
				).toBe("pending");
				expect(f.memory.runtime.memory.get(memory.id).status).toBe("active");
				expect(f.service.listThreads()).toHaveLength(0);
				expect(
					f.sqlite
						.prepare(
							"SELECT read_at,ignored_at FROM watchdog_alerts WHERE id='race-alert'",
						)
						.get(),
				).toEqual({ read_at: null, ignored_at: null });
				expect(
					f.sqlite
						.prepare(
							"SELECT id FROM butler_turns WHERE id='must-not-be-admitted'",
						)
						.get(),
				).toBeNull();
			} finally {
				try {
					streamController?.close();
				} catch {}
				await f.dispose();
			}
		});
	}
