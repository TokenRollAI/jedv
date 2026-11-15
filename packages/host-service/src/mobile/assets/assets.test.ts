import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { Window } = createRequire(
	realpathSync(
		new URL(
			"../../../../i18n/node_modules/@happy-dom/global-registrator/package.json",
			import.meta.url,
		),
	),
)("happy-dom");

import { resolveLocale, SUPPORTED_LOCALES } from "@jedv/i18n/locales";
import { mobileCatalogs } from "./catalog";
import { mobilePublicAssets } from "./index";
import { mobileMessages } from "./messages";

const rootPath = "/mobile/";
const session = {
	sessionId: "fixture-session",
	label: "QA device",
	csrfToken: "fixture-csrf",
	expiresAt: Date.now() + 3600000,
};
const card = {
	id: "approval",
	threadId: "thread",
	actionType: "stopTeam",
	targetId: "team",
	summary: "Stop the fixture Team",
	payload: { actionType: "stopTeam", teamId: "team" },
	payloadHash: "a".repeat(64),
	status: "pending",
	createdAt: Date.now(),
	expiresAt: Date.now() + 600000,
	resolvedAt: null,
	error: null,
};
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
async function fixture(
	handler?: (path: string, init: RequestInit) => Response | Promise<Response>,
	options: Record<string, unknown> = {},
) {
	const dir = mkdtempSync(join(tmpdir(), "jedv-mobile-assets-"));
	for (const asset of mobilePublicAssets.filter((a) =>
		a.path.endsWith(".js"),
	)) {
		writeFileSync(join(dir, asset.path.slice(rootPath.length)), asset.content);
	}
	writeFileSync(join(dir, "package.json"), '{"type":"module"}');
	const { mountMobile } = await import(join(dir, "app.js"));
	const { resolveLanguage, createTranslator } = await import(
		join(dir, "i18n.js")
	);
	const window = new Window({ url: "http://mobile.test/mobile/" });
	window.document.body.innerHTML = '<div id="app" class="app"></div>';
	const calls: Array<{ path: string; init: RequestInit }> = [];
	const fetcher = async (path: string, init: RequestInit) => {
		calls.push({ path, init });
		if (handler) {
			const value = await handler(path, init);
			if (value) return value;
		}
		if (path.endsWith("/session")) return json(session);
		if (path.endsWith("/butler/state"))
			return json({ currentThreadId: null, thread: null });
		if (path.endsWith("/threads")) return json([]);
		if (path.includes("/history?"))
			return json([
				{
					id: "human",
					threadId: "thread",
					requestId: "request",
					role: "human",
					content: '<img src=x onerror="bad()">',
					createdAt: 1,
				},
			]);
		if (path.startsWith("/mobile/api/inbox?"))
			return json({
				alerts: [],
				groups: [],
				badge: { count: 1, pendingApprovals: 1, unreadHighFaultGroups: 0 },
				approvals: [card],
			});
		if (path.includes("/approvals?")) return json([card]);
		if (path.endsWith("/status"))
			return json({
				teams: [
					{
						id: "team",
						name: "Fixture",
						members: [
							{
								id: "leader",
								name: "Leader",
								role: "leader",
								agentId: "codex",
								status: "active",
								deliveryState: "working",
								unackedCount: 1,
							},
						],
					},
				],
				automations: [],
			});
		if (path.endsWith("/logout")) return json({ loggedOut: true });
		throw new Error("Unexpected path: " + path);
	};
	const app = mountMobile({
		window,
		document: window.document,
		fetcher,
		uuid: () => "stable-request",
		...options,
	});
	await app.ready;
	app.actions.screen("butler");
	return {
		app,
		window,
		calls,
		resolveLanguage,
		createTranslator,
		dispose() {
			app.dispose();
			void window.happyDOM.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
test("portable public export includes installable Jedv icons, modules, manifest and static-only worker", () => {
	const paths = mobilePublicAssets.map((a) => a.path);
	expect(new Set(paths).size).toBe(paths.length);
	for (const asset of mobilePublicAssets) {
		expect(asset.path === "/mobile" || asset.path.startsWith("/mobile/")).toBe(
			true,
		);
		expect(asset.path).not.toContain("..");
		expect(asset.path.startsWith("/mobile/api")).toBe(false);
		expect(asset.cacheControl).toBeTruthy();
	}
	const manifest = JSON.parse(
		String(
			mobilePublicAssets.find((a) => a.path.endsWith(".webmanifest"))?.content,
		),
	);
	expect(manifest.start_url).toBe("/mobile/");
	for (const icon of manifest.icons) expect(paths).toContain(icon.src);
	const shell = String(
		mobilePublicAssets.find((a) => a.path === "/mobile")?.content,
	);
	expect(shell).not.toContain("https://");
	expect(shell).not.toContain("onload=");
	expect(shell).toContain("interactive-widget=resizes-content");
});
test("18 catalogs cover every mobile ID and preserve translated named placeholders", () => {
	const catalogs = mobileCatalogs();
	expect(Object.keys(catalogs)).toEqual([...SUPPORTED_LOCALES]);
	for (const locale of SUPPORTED_LOCALES) {
		expect(Object.keys(catalogs[locale] ?? {})).toHaveLength(
			Object.keys(mobileMessages).length,
		);
		expect(catalogs[locale]?.expiresAt).toContain("{time}");
		expect(catalogs[locale]?.mailCount).toContain("{count}");
	}
	expect(catalogs["zh-CN"]?.inbox).not.toBe(catalogs.en?.inbox);
});
test("language resolution follows project aliases; only the fixed preference cookie persists", async () => {
	const f = await fixture();
	try {
		for (const values of [
			["zh-Hant-HK"],
			["pt-PT"],
			["xx", "ja"],
			["de-DE"],
			["zh-CN-u-nu-latn"],
		])
			expect(f.resolveLanguage(values)).toBe(resolveLocale(values));
		f.app.actions.language("zh-CN");
		const translator = f.createTranslator(
			f.window.document,
			f.window.navigator,
		);
		expect(translator.t("expiresAt", { time: "TEST-TIME" })).toContain(
			"TEST-TIME",
		);
		expect(translator.t("expiresAt", { time: "TEST-TIME" })).not.toContain(
			"{time}",
		);
		expect(f.window.document.cookie).toContain("jedv_locale=zh-CN");
		expect(f.window.localStorage.length).toBe(0);
		expect(f.window.sessionStorage.length).toBe(0);
		expect(f.window.document.cookie).not.toContain(session.csrfToken);
		await f.app.actions.logout();
		expect(f.window.document.cookie).not.toContain("jedv_locale=");
	} finally {
		f.dispose();
	}
});
test("all API traffic is same-origin, no-store, and authenticated POSTs carry only the in-memory CSRF", async () => {
	const f = await fixture();
	try {
		await f.app.actions.logout();
		const request = f.calls.find((c) => c.path.endsWith("/logout"));
		expect(request?.init.credentials).toBe("same-origin");
		expect(request?.init.cache).toBe("no-store");
		expect(
			(request?.init.headers as Record<string, string>)["x-jedv-mobile-csrf"],
		).toBe(session.csrfToken);
		expect(request?.init.headers).not.toHaveProperty("Origin");
		expect(request?.init.headers).not.toHaveProperty("Authorization");
		expect(f.app.state.phase).toBe("pair");
	} finally {
		f.dispose();
	}
});
test("message errors keep the draft and stable request ID; duplicate submits make one mutation", async () => {
	let mode = "fail",
		release: () => void = () => {};
	const sent: unknown[] = [];
	const f = await fixture(async (path, init) => {
		if (path.endsWith("/butler/send")) {
			sent.push(JSON.parse(String(init.body)));
			if (mode === "fail")
				return new Promise<Response>((resolve) => {
					release = () => resolve(json({ error: "fixture failure" }, 500));
				});
			return json({
				threadId: "thread",
				requestId: "stable-request",
				reply: "ok",
				approvals: [],
				degraded: false,
				reason: null,
			});
		}
		return undefined as never;
	});
	try {
		f.app.actions.draft("Keep this draft");
		const first = f.app.actions.send();
		await f.app.actions.send();
		expect(sent).toHaveLength(1);
		release();
		await first;
		expect(f.app.state.draft).toBe("Keep this draft");
		expect(f.app.state.error.key).toBe("requestFailed");
		expect(
			f.window.document.querySelector(".banner.error button")?.textContent,
		).toBe(mobileCatalogs().en?.refresh);
		mode = "success";
		await f.app.actions.send();
		expect(sent).toHaveLength(2);
		expect(sent[0]).toEqual(sent[1]);
		expect(f.app.state.draft).toBe("");
		f.app.actions.screen("butler");
		expect(f.window.document.querySelector("main img[src=x]")).toBeNull();
		expect(f.window.document.querySelector("main")?.textContent).toContain(
			"<img",
		);
	} finally {
		f.dispose();
	}
});
test("401 clears private page data and CSRF then returns to pairing", async () => {
	let fail = false;
	const f = await fixture((path) =>
		fail && path.endsWith("/session")
			? json({ error: "expired" }, 401)
			: (undefined as never),
	);
	try {
		f.app.actions.draft("private draft");
		fail = true;
		await f.app.actions.refresh(true);
		expect(f.app.state.phase).toBe("pair");
		expect(f.app.state.messages).toEqual([]);
		expect(f.app.state.draft).toBe("");
		expect(f.app.state.session).toBeNull();
		expect(f.window.document.getElementById("pair-code")).not.toBeNull();
	} finally {
		f.dispose();
	}
});
test.each([
	409, 412,
])("approval HTTP %s preserves pending state and requires explicit refresh without retry", async (status) => {
	let mutations = 0;
	const f = await fixture((path) => {
		if (path.includes("/resolve")) {
			mutations++;
			return json(
				{
					error:
						status === 412
							? "Approval target changed; request a new approval"
							: "Approval was claimed concurrently",
				},
				status,
			);
		}
		return undefined as never;
	});
	try {
		f.app.actions.screen("inbox");
		await f.app.actions.resolve(card, "approve");
		await f.app.actions.resolve(card, "approve");
		expect(mutations).toBe(1);
		expect(f.app.state.approvals[0].status).toBe("pending");
		expect(f.app.state.error.key).toBe("approvalConflict");
		expect(mobileCatalogs().en?.approvalConflict).toBe(
			"The approval status or target has changed. Refresh to verify, and request a new approval if needed.",
		);
		expect(
			f.window.document.querySelector(".banner.error")?.textContent,
		).toContain(mobileCatalogs().en?.approvalConflict);
		expect(f.app.state.uncertainApprovals.has(card.id)).toBe(true);
		f.window.dispatchEvent(new f.window.Event("offline"));
		await f.app.actions.resolve(card, "reject");
		expect(mutations).toBe(1);
		f.window.dispatchEvent(new f.window.Event("online"));
		await f.app.actions.refresh(false);
		expect(f.app.state.uncertainApprovals.has(card.id)).toBe(true);
		expect(
			f.window.document.querySelector(
				"article[data-approval-id] .actions button",
			)?.disabled,
		).toBe(true);
		await f.app.actions.refresh(true);
		expect(mutations).toBe(1);
		expect(f.app.state.uncertainApprovals.has(card.id)).toBe(false);
		expect(
			f.window.document.querySelector(
				"article[data-approval-id] .actions button",
			)?.textContent,
		).toBeTruthy();
	} finally {
		f.dispose();
	}
});
test.each([
	"no_key",
	"unavailable",
])("%s stays beside its turn without a global duplicate or history loss", async (reason) => {
	let sent = false;
	const original = "server original";
	const messages = [
		{
			id: "prior",
			threadId: "thread",
			requestId: "prior-request",
			role: "assistant",
			content: original,
			degradedReason: reason,
			createdAt: 1,
		},
		{
			id: "natural",
			threadId: "thread",
			requestId: "natural-request",
			role: "assistant",
			content: "Observed Leader reply",
			createdAt: 2,
		},
	];
	const f = await fixture((path) => {
		if (path.endsWith("/butler/send")) {
			sent = true;
			return json({
				threadId: "thread",
				requestId: "stable-request",
				reply: original,
				approvals: [],
				degraded: true,
				reason,
			});
		}
		if (path.includes("/history?"))
			return json([
				...messages,
				...(sent
					? [
							{
								id: "latest",
								threadId: "thread",
								requestId: "stable-request",
								role: "assistant",
								content: original,
								degradedReason: reason,
								createdAt: 3,
							},
						]
					: []),
			]);
		return undefined as never;
	});
	try {
		f.app.actions.language("zh-CN");
		await f.app.actions.thread("thread");
		f.app.actions.draft("中文问题");
		await f.app.actions.send();
		expect(f.app.state.degraded).toBe(reason);
		expect(f.window.document.querySelector(".banner")).toBeNull();
		const bubbles = f.window.document.querySelectorAll(
			"article.message.assistant",
		);
		expect(bubbles).toHaveLength(3);
		const hint =
			mobileCatalogs()["zh-CN"]?.[
				reason === "no_key" ? "noKey" : "modelUnavailable"
			];
		expect(bubbles[0]?.textContent).toBe(hint);
		expect(bubbles[1]?.textContent).toBe("Observed Leader reply");
		expect(bubbles[2]?.textContent).toBe(hint);
		expect(
			f.app.state.messages.map(
				(message: { content: string }) => message.content,
			),
		).toEqual([original, "Observed Leader reply", original]);
		expect(f.window.document.querySelector("#draft")?.disabled).toBe(false);
		f.app.actions.screen("status");
		expect(f.window.document.querySelector(".banner")).toBeNull();
		expect(
			f.window.document.querySelector("img.agent-logo")?.getAttribute("src"),
		).toContain("/mobile/icons/preset-codex");
		expect(
			f.window.document.querySelector("img.crown")?.getAttribute("alt"),
		).toBe(mobileCatalogs()["zh-CN"]?.leader);
	} finally {
		f.dispose();
	}
});
test("Status keeps Leader first, preserves worker order, and distinguishes neutral Unknown and Idle", async () => {
	const members = [
		{
			id: "b",
			name: "Worker B",
			role: "worker",
			agentId: "codex",
			status: "active",
			deliveryState: "unknown",
		},
		{
			id: "leader",
			name: "Leader",
			role: "leader",
			agentId: "claude",
			status: "active",
			deliveryState: "working",
		},
		{
			id: "a",
			name: "Worker A",
			role: "worker",
			agentId: "codex",
			status: "active",
			deliveryState: "idle",
		},
		{
			id: "fallback",
			name: "New state",
			role: "worker",
			agentId: "codex",
			status: "active",
			deliveryState: "future-state",
		},
	];
	const f = await fixture((path) =>
		path.endsWith("/status")
			? json({
					teams: [{ id: "team", name: "Fixture", members }],
					automations: [],
				})
			: (undefined as never),
	);
	try {
		f.app.actions.screen("status");
		const rows = () =>
			Array.from(f.window.document.querySelectorAll(".member")) as any[];
		expect(
			rows().map((row) => row.querySelector(".member-name").textContent),
		).toEqual(["Leader", "Worker B", "Worker A", "New state"]);
		expect(
			f.app.state.status.teams[0].members.map(
				(member: { id: string }) => member.id,
			),
		).toEqual(["b", "leader", "a", "fallback"]);
		expect(rows()[0].querySelector("img.crown")).not.toBeNull();
		expect(rows()[1].querySelector(".status img").getAttribute("src")).toBe(
			"/mobile/icons/help.svg",
		);
		expect(rows()[1].querySelector(".status").textContent).toBe(
			mobileCatalogs().en?.unknown,
		);
		expect(rows()[2].querySelector(".status img").getAttribute("src")).toBe(
			"/mobile/icons/circle.svg",
		);
		expect(rows()[2].querySelector(".status").textContent).toBe(
			mobileCatalogs().en?.idle,
		);
		expect(rows()[3].querySelector(".status img").getAttribute("src")).toBe(
			"/mobile/icons/help.svg",
		);
		for (const name of ["help", "circle"]) {
			const svg = String(
				mobilePublicAssets.find(
					(asset) => asset.path === `/mobile/icons/${name}.svg`,
				)?.content,
			);
			expect(svg).toContain('stroke="#9a96b1"');
			expect(svg).not.toContain("#edbd3d");
			expect(svg).not.toContain("check");
		}
		await f.app.actions.refresh(true);
		expect(
			rows().map((row) => row.querySelector(".member-name").textContent),
		).toEqual(["Leader", "Worker B", "Worker A", "New state"]);
	} finally {
		f.dispose();
	}
});
test("static controller pairs, sends, resolves and signs out through real M5 whitelist routes", async () => {
	const { networkFixture } = await import("../../peers/test-fixture");
	const { registerMobileHttp } = await import("../http");
	const { Hono } = await import("hono");
	const { createHostMemoryRuntime } = await import("../../memory/host-runtime");
	const { ButlerService } = await import("../../butler/service");
	const { ButlerTools } = await import("../../butler/tools");
	const backend = networkFixture();
	const { OutboxForwarder } = await import("../../peers/outbox-forwarder");
	const outbox = new OutboxForwarder(backend.peers, { clock: backend.clock });
	backend.ctx.runtime.teamwork = {
		team: backend.team,
		mail: backend.mail,
		peers: backend.peers,
		outbox,
		ready: Promise.resolve(),
		dispose: async () => {},
	};
	const memory = createHostMemoryRuntime(backend.ctx, {
		home: () => backend.root,
		clock: { now: backend.clock.now, setInterval: () => () => {} },
	});
	backend.ctx.runtime.memory = memory.runtime;
	const butler = new ButlerService({
		db: backend.sqlite,
		ai: memory.runtime.ai,
		tools: new ButlerTools(backend.ctx),
		now: backend.clock.now,
		alerts: () => [],
		watchdog: memory.runtime.watchdog,
	});
	backend.ctx.runtime.butler = butler;
	const surface = new Hono();
	registerMobileHttp(surface, backend.ctx, backend.mobile, {
		assets: mobilePublicAssets,
	});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: surface.fetch,
	});
	const endpoint = "http://127.0.0.1:" + server.port;
	const dir = mkdtempSync(join(tmpdir(), "jedv-mobile-live-"));
	let cookie = "";
	let controller: any,
		window: any,
		requestCounter = 0;
	try {
		for (const asset of mobilePublicAssets.filter((a) =>
			a.path.endsWith(".js"),
		))
			writeFileSync(
				join(dir, asset.path.slice(rootPath.length)),
				asset.content,
			);
		writeFileSync(join(dir, "package.json"), '{"type":"module"}');
		const { mountMobile } = await import(join(dir, "app.js"));
		window = new Window({ url: endpoint + "/mobile/" });
		window.document.body.innerHTML = '<div id="app" class="app"></div>';
		const fetcher = async (path: string, init: RequestInit) => {
			const headers = new Headers(init.headers);
			if (cookie) headers.set("Cookie", cookie);
			if (init.method === "POST") headers.set("Origin", endpoint);
			headers.set("Sec-Fetch-Site", "same-origin");
			const response = await fetch(endpoint + path, { ...init, headers });
			const set = response.headers.get("set-cookie");
			if (set) cookie = set.split(";")[0] ?? "";
			return response;
		};
		controller = mountMobile({
			window,
			document: window.document,
			fetcher,
			clock: backend.clock.now,
			uuid: () =>
				requestCounter++ === 0
					? "real-mobile-request"
					: `real-mobile-request-${requestCounter}`,
		});
		await controller.ready;
		expect(controller.state.phase).toBe("pair");
		controller.actions.pairCode(backend.mobile.createPairingCode().code);
		controller.actions.deviceLabel("Temporary Phone");
		await controller.actions.pair();
		expect(controller.state.phase).toBe("authenticated");
		expect(controller.state.session.label).toBe("Temporary Phone");
		expect(window.document.cookie).not.toContain("jedv_mobile");
		const shell = await fetch(endpoint + "/mobile");
		expect(shell.status).toBe(200);
		expect(shell.headers.get("content-security-policy")).toContain(
			"script-src 'self'",
		);
		controller.actions.screen("butler");
		const icon = await fetch(endpoint + "/mobile/icons/icon-192.png");
		expect(icon.status).toBe(200);
		expect(new Uint8Array(await icon.arrayBuffer()).slice(0, 4)).toEqual(
			new Uint8Array([137, 80, 78, 71]),
		);
		controller.actions.language("zh-CN");
		controller.actions.draft("Summarize this Team");
		await controller.actions.send();
		expect(controller.state.degraded).toBe("no_key");
		expect(
			window.document.querySelector("article.message.assistant")?.textContent,
		).toBe(mobileCatalogs()["zh-CN"]?.noKey);
		expect(
			butler.history({ threadId: controller.state.threadId })[0]?.content,
		).toBe("Summarize this Team");
		const originalReadKey = memory.runtime.secrets.readKey;
		let attentionKeyReads = 0;
		memory.runtime.secrets.readKey = () => {
			attentionKeyReads++;
			throw Error("Attention cannot read the Key");
		};
		for (let i = 0; i < 3; i++)
			backend.mail.send({
				teamId: backend.teamId,
				to: "leader",
				type: "agent.message",
				subject: "",
				body: `Attention fixture ${i}`,
				dedupeKey: `phone-attention-${i}`,
			});
		backend.advance(6 * 60_000);
		await memory.runtime.watchdog.scan();
		await controller.actions.refresh(true);
		controller.actions.screen("inbox");
		let group = controller.state.groups.find(
			(item: any) => item.kind === "mail_unacked",
		);
		expect(group.activeCount).toBe(3);
		expect(
			window.document.querySelectorAll("article[data-group-key]"),
		).toHaveLength(1);
		expect(controller.state.badge.count).toBe(0);
		const visible = window.document.querySelector("main").cloneNode(true);
		for (const detail of visible.querySelectorAll("details")) detail.remove();
		expect(visible.textContent).not.toContain(backend.teamId);
		expect(visible.textContent).not.toContain(group.groupKey);
		await controller.actions.markAttentionRead(group);
		group = controller.state.groups[0];
		expect(group.disposition).toBe("open");
		expect(group.unread).toBe(false);
		await controller.actions.ignoreAttention(group, "Handled on phone");
		expect(controller.state.groups).toHaveLength(0);
		await controller.actions.attentionView("handled");
		expect(controller.state.groups[0].disposition).toBe("ignored");
		let deliveries = backend.sqlite
			.prepare("SELECT id,acked_at AS ackedAt FROM mail_deliveries")
			.all() as { id: string; ackedAt: number | null }[];
		expect(deliveries.every((item) => item.ackedAt === null)).toBe(true);
		backend.mail.send({
			teamId: backend.teamId,
			to: "leader",
			type: "agent.message",
			subject: "",
			body: "Fourth mail",
			dedupeKey: "phone-attention-fourth",
		});
		backend.advance(6 * 60_000);
		await memory.runtime.watchdog.scan();
		await controller.actions.attentionView("open");
		expect(controller.state.groups[0].activeCount).toBe(4);
		expect(controller.state.groups[0].unread).toBe(true);
		deliveries = backend.sqlite
			.prepare("SELECT id,acked_at AS ackedAt FROM mail_deliveries")
			.all() as { id: string; ackedAt: number | null }[];
		for (const item of deliveries)
			backend.mail.consume(
				{ teamId: backend.teamId, member: "leader", deliveryId: item.id },
				true,
			);
		await memory.runtime.watchdog.scan();
		await controller.actions.attentionView("handled");
		expect(controller.state.groups[0].disposition).toBe("resolved");
		expect(controller.state.groups[0].activeCount).toBe(0);
		expect(attentionKeyReads).toBe(0);
		memory.runtime.secrets.readKey = originalReadKey;
		await controller.actions.attentionView("open");
		const approval = butler.createApproval(
			{ actionType: "stopTeam", teamId: backend.teamId },
			{
				threadId: controller.state.threadId,
				requestId: "real-mobile-request",
				humanVerbatim: "Summarize this Team",
			},
		);
		await controller.actions.refresh(true);
		controller.actions.screen("inbox");
		expect(controller.state.approvals[0].id).toBe(approval.id);
		expect(backend.team.team(backend.teamId).status).toBe("paused");
		await controller.actions.resolve(controller.state.approvals[0], "approve");
		expect(controller.state.approvals[0].status).toBe("executed");
		expect(backend.team.team(backend.teamId).status).toBe("stopped");
		await controller.actions.refresh(true);
		expect(controller.state.status.teams).toHaveLength(0);
		expect(controller.state.knownTeams[0].name).toBe("Network Team");
		controller.actions.screen("butler");
		const approvalTarget = window.document.querySelector(
			"article[data-approval-id] .card-body",
		);
		expect(approvalTarget?.textContent).toContain("Network Team");
		const firstThread = controller.state.threadId;
		await controller.actions.newTopic();
		expect(butler.state().currentThreadId).toBe(firstThread);
		controller.actions.draft("新话题\n完整中文原文");
		await controller.actions.send();
		const currentThread = controller.state.threadId;
		expect(currentThread).not.toBe(firstThread);
		expect(butler.state().currentThreadId).toBe(currentThread);
		expect(butler.history({ threadId: currentThread })[0]?.content).toBe(
			"新话题\n完整中文原文",
		);
		await controller.actions.thread(firstThread);
		controller.actions.draft("在旧历史继续追问");
		await controller.actions.send();
		expect(controller.state.threadId).toBe(firstThread);
		expect(butler.state().currentThreadId).toBe(currentThread);
		await controller.actions.logout();
		expect(controller.state.phase).toBe("pair");
		expect(backend.mobile.listSessions()[0]?.revokedAt).not.toBeNull();
		expect(
			(
				await fetch(endpoint + "/mobile/api/session", {
					headers: { Cookie: cookie },
				})
			).status,
		).toBe(401);
	} finally {
		controller?.dispose();
		if (window) await window.happyDOM.close();
		server.stop(true);
		await butler.dispose();
		await memory.dispose();
		await outbox.dispose();
		await backend.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
});
test("themed language and conversation pickers use accessible listboxes with keyboard focus return", async () => {
	const f = await fixture();
	try {
		const menu = f.window.document.querySelector("details.account");
		menu.open = true;
		const trigger = f.window.document.getElementById("language");
		trigger.focus();
		trigger.dispatchEvent(
			new f.window.KeyboardEvent("keydown", {
				key: "ArrowDown",
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(f.window.document.activeElement?.getAttribute("role")).toBe(
			"option",
		);
		const list = f.window.document.getElementById("language-listbox");
		f.window.document.activeElement.dispatchEvent(
			new f.window.KeyboardEvent("keydown", {
				key: "End",
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(f.window.document.activeElement).toBe(list.lastElementChild);
		f.window.document.activeElement.dispatchEvent(
			new f.window.KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(f.window.document.activeElement).toBe(trigger);
		expect(f.window.document.querySelector("select,option")).toBeNull();
		expect(f.window.document.getElementById("thread-select")).toBeNull();
		const butlerIcons = f.window.document.querySelectorAll(
			'img[src="/mobile/icons/butler.svg"]',
		);
		expect(butlerIcons.length).toBe(2);
	} finally {
		f.dispose();
	}
});

test("stable default ignores recent ordering, follows only idle default and locks drafts/retries/history", async () => {
	let current = "t1";
	const sent: any[] = [];
	const f = await fixture((path, init) => {
		if (path.endsWith("/butler/state"))
			return json({
				currentThreadId: current,
				thread: { id: current, kind: "conversation" },
			});
		if (path.endsWith("/threads"))
			return json([
				{ id: "t9", title: "Recent audit", kind: "approval_audit" },
				{ id: "t2", title: "Recently updated", kind: "conversation" },
				{ id: "t1", title: "Original", kind: "conversation" },
			]);
		if (path.endsWith("/send")) {
			sent.push(JSON.parse(String(init.body)));
			return json({ error: "failure" }, 500);
		}
		return undefined as never;
	});
	try {
		expect(f.app.state.threadId).toBe("t1");
		expect(f.app.state.threads).toHaveLength(2);
		current = "t2";
		await f.app.actions.refresh(true);
		expect(f.app.state.threadId).toBe("t2");
		f.app.actions.draft("原话\nKeep exactly");
		current = "t3";
		await f.app.actions.refresh(true);
		expect(f.app.state.threadId).toBe("t2");
		expect(f.app.state.draft).toBe("原话\nKeep exactly");
		await f.app.actions.send();
		current = "t4";
		await f.app.actions.refresh(true);
		expect(f.app.state.threadId).toBe("t2");
		await f.app.actions.send();
		expect(sent).toHaveLength(2);
		expect(sent[0]).toEqual(sent[1]);
		expect(sent[0].threadId).toBe("t2");
		await f.app.actions.thread("t1");
		await f.app.actions.refresh(true);
		expect(f.app.state.threadId).toBe("t1");
		expect(f.app.state.followDefault).toBe(false);
		await f.app.actions.current();
		expect(f.app.state.threadId).toBe("t4");
		expect(
			f.app.state.savedViews.some(
				(view: any) => view.label === "原话\nKeep exactly",
			),
		).toBe(true);
		expect(f.window.document.querySelector("#thread-select")).toBeNull();
		f.app.actions.conversations();
		expect(
			f.window.document.querySelector("#conversation-history")?.textContent,
		).toContain("Original");
	} finally {
		f.dispose();
	}
});
test("new topic can leave an old busy turn; late reply stays bound and uncertain new-topic retry never moves the pointer", async () => {
	let current = "old",
		id = 0,
		releaseOld: (response: Response) => void = () => {},
		firstNew = true;
	const bodies: any[] = [];
	const f = await fixture(
		(path, init) => {
			if (path.endsWith("/butler/state"))
				return json({ currentThreadId: current, thread: null });
			if (path.includes("/history?")) {
				const thread = new URL("http://fixture" + path).searchParams.get(
					"threadId",
				);
				return json([
					{
						id: thread,
						threadId: thread,
						requestId: "request",
						role: "assistant",
						content: "Reply " + thread,
						createdAt: 1,
					},
				]);
			}
			if (path.endsWith("/send")) {
				const body = JSON.parse(String(init.body));
				bodies.push(body);
				if (body.threadId === "old")
					return new Promise<Response>((resolve) => {
						releaseOld = resolve;
					});
				if (body.newTopic && firstNew) {
					firstNew = false;
					current = "new-one";
					return json({ error: "uncertain" }, 500);
				}
				return json({
					threadId: "new-one",
					currentThreadId: "new-one",
					requestId: body.requestId,
					reply: "Stored new reply",
					approvals: [],
					reason: null,
					degraded: false,
				});
			}
			return undefined as never;
		},
		{ uuid: () => `request-${++id}` },
	);
	try {
		f.app.actions.draft("Old in flight");
		const old = f.app.actions.send();
		await f.app.actions.newTopic();
		expect(f.app.state.sending).toBe(false);
		f.app.actions.draft("新话题原文");
		await f.app.actions.send();
		expect(bodies[1].newTopic).toBe(true);
		expect(bodies[1].threadId).toBeUndefined();
		current = "other-device";
		await f.app.actions.refresh(true);
		expect(f.app.state.draft).toBe("新话题原文");
		await f.app.actions.send();
		expect(bodies[2]).toEqual(bodies[1]);
		expect(current).toBe("other-device");
		expect(f.app.state.threadId).toBe("new-one");
		expect(f.app.state.currentThreadId).toBe("other-device");
		expect(f.app.state.awayFromCurrent).toBe(true);
		releaseOld(
			json({
				threadId: "old",
				currentThreadId: "old",
				requestId: bodies[0].requestId,
				reply: "Old done",
				approvals: [],
				reason: null,
				degraded: false,
			}),
		);
		await old;
		expect(f.app.state.threadId).toBe("new-one");
		expect(f.app.state.messages[0].content).toBe("Reply new-one");
		await f.app.actions.thread("old");
		expect(f.app.state.messages[0].content).toBe("Reply old");
	} finally {
		f.dispose();
	}
});
test("state404 does not guess a recent thread or submit, and follow-up context is structured without an automatic send", async () => {
	let supported = false;
	const bodies: any[] = [];
	const f = await fixture((path, init) => {
		if (path.endsWith("/butler/state"))
			return supported
				? json({ currentThreadId: "stable", thread: null })
				: json({ error: "unsupported" }, 404);
		if (path.endsWith("/threads"))
			return json([{ id: "recent", title: "Recent" }]);
		if (path.endsWith("/send")) {
			const body = JSON.parse(String(init.body));
			bodies.push(body);
			return json({
				threadId: "stable",
				currentThreadId: "stable",
				requestId: body.requestId,
				reply: "ok",
				approvals: [],
				reason: null,
				degraded: false,
			});
		}
		return undefined as never;
	});
	try {
		expect(f.app.state.conversationReady).toBe(false);
		expect(f.app.state.threadId).toBeNull();
		f.app.actions.draft("kept");
		await f.app.actions.send();
		expect(bodies).toHaveLength(0);
		supported = true;
		await f.app.actions.refresh(true);
		await f.app.actions.ask({ approvalId: "approval", teamId: "team" });
		expect(bodies).toHaveLength(0);
		f.app.actions.draft("追问原话");
		await f.app.actions.send();
		expect(bodies[0].context).toEqual({
			approvalId: "approval",
			teamId: "team",
		});
		expect(bodies[0].humanText).toBe("追问原话");
		expect(bodies[0].threadId).toBe("stable");
	} finally {
		f.dispose();
	}
});

test("message roles render safe Markdown, preserve tool disclosure and show actual approval status without hashes", async () => {
	const f = await fixture((path) => {
		if (path.endsWith("/butler/state"))
			return json({ currentThreadId: "thread", thread: null });
		if (path.includes("/history?"))
			return json([
				{
					id: "human",
					threadId: "thread",
					requestId: "request",
					role: "human",
					content: "## 用户原话\n<script>not HTML</script>",
					createdAt: 1,
				},
				{
					id: "tool",
					threadId: "thread",
					requestId: "request",
					role: "tool",
					content: '{"status":"observed"}',
					createdAt: 2,
				},
				{
					id: "assistant",
					threadId: "thread",
					requestId: "request",
					role: "assistant",
					content:
						"## 实际回复\n\n- **Facts**\n- `code`\n\n<img src=x onerror=alert(1)>",
					createdAt: 3,
				},
			]);
		if (path.includes("/approvals?"))
			return json([{ ...card, status: "executed", resolvedAt: 2 }]);
		return undefined as never;
	});
	try {
		expect(f.window.document.querySelector(".message.human")?.textContent).toBe(
			"## 用户原话\n<script>not HTML</script>",
		);
		expect(f.window.document.querySelector(".message.human h2")).toBeNull();
		expect(
			f.window.document.querySelector(".message.assistant h2")?.textContent,
		).toBe("实际回复");
		expect(
			f.window.document.querySelectorAll(".message.assistant li"),
		).toHaveLength(2);
		expect(
			f.window.document.querySelector("main script,main img[src=x]"),
		).toBeNull();
		const tool = f.window.document.querySelector("details.tool-record");
		expect(tool.open).toBe(false);
		expect(tool.querySelector("pre").textContent).toBe('{"status":"observed"}');
		tool.open = true;
		await f.app.actions.refresh(true);
		expect(f.window.document.querySelector("details.tool-record").open).toBe(
			true,
		);
		expect(
			f.window.document.querySelector("article[data-approval-id] .badge")
				?.textContent,
		).toBe(mobileCatalogs().en?.executed);
		expect(
			f.window.document.querySelector("article[data-approval-id] .actions"),
		).toBeNull();
		expect(f.window.document.body.textContent).not.toContain(card.payloadHash);
	} finally {
		f.dispose();
	}
});

const attentionGroup = {
	groupKey: "team_attention:private-team-uuid:private-member-uuid",
	kind: "team_attention",
	severity: "high",
	subject: "Raw subject private-team-uuid",
	body: "Raw structured detail private-member-uuid",
	disposition: "open",
	unread: true,
	activeCount: 3,
	totalCount: 3,
	firstCreatedAt: 1,
	latestCreatedAt: 2,
	source: {
		kind: "team_member",
		teamId: "private-team-uuid",
		memberId: "private-member-uuid",
		workspaceId: null,
		projectId: null,
		terminalId: null,
		terminalLive: false,
		fallback: "team",
		mailDeliveryId: null,
		automationId: null,
		automationRunId: null,
	},
	items: [
		{
			id: "private-alert-uuid",
			dedupeKey: "private-protocol",
			body: "Details",
			createdAt: 1,
			readAt: null,
			ignoredAt: null,
			ignoreReason: null,
			resolvedAt: null,
		},
	],
};
test("Attention renders only real groups and full badge, submits one CSRF read/ignore and keeps explicit refresh on uncertainty", async () => {
	let group: any = { ...attentionGroup },
		ignored = false;
	let posts = 0;
	const f = await fixture((path, init) => {
		if (path.startsWith("/mobile/api/inbox?")) {
			const view = new URL("http://fixture" + path).searchParams.get("view");
			return json({
				alerts: [{ id: "legacy", subject: "MUST NOT RENDER" }],
				groups:
					(view === "open" && !ignored) ||
					(view === "handled" && ignored) ||
					view === "all"
						? [group]
						: [],
				approvals: [],
				badge: { pendingApprovals: 7, unreadHighFaultGroups: 130, count: 137 },
			});
		}
		if (path.endsWith("/attention/read")) {
			posts++;
			group = { ...group, unread: false };
			return json({
				updatedCount: 3,
				badge: { pendingApprovals: 7, unreadHighFaultGroups: 129, count: 136 },
			});
		}
		if (path.endsWith("/attention/ignore")) {
			posts++;
			ignored = true;
			group = { ...group, disposition: "ignored" };
			return json({
				updatedCount: 3,
				disposition: "ignored",
				badge: { pendingApprovals: 7, unreadHighFaultGroups: 129, count: 136 },
			});
		}
		return undefined as never;
	});
	try {
		f.app.actions.screen("inbox");
		expect(f.window.document.querySelector(".nav-badge")?.textContent).toBe(
			"137",
		);
		expect(
			f.window.document.querySelectorAll("article[data-group-key]"),
		).toHaveLength(1);
		const visible = f.window.document.querySelector("main").cloneNode(true);
		for (const details of visible.querySelectorAll("details")) details.remove();
		expect(visible.textContent).not.toContain("private-");
		expect(visible.textContent).not.toContain("MUST NOT RENDER");
		expect(f.window.document.querySelectorAll("nav button")).toHaveLength(3);
		expect(f.window.document.querySelector("select")).toBeNull();
		await f.app.actions.markAttentionRead(f.app.state.groups[0]);
		expect(f.app.state.groups[0].disposition).toBe("open");
		expect(f.app.state.groups[0].unread).toBe(false);
		expect(posts).toBe(1);
		f.app.actions.editIgnore(group.groupKey);
		expect(f.window.document.querySelector("#ignore-reason")).not.toBeNull();
		await f.app.actions.ignoreAttention(f.app.state.groups[0], "Known issue");
		expect(posts).toBe(2);
		expect(f.app.state.groups).toHaveLength(0);
		await f.app.actions.attentionView("handled");
		expect(f.app.state.groups[0].disposition).toBe("ignored");
		expect(
			f.window.document.querySelector("article[data-group-key] .badge")
				?.textContent,
		).toBe(mobileCatalogs().en?.ignored);
		for (const call of f.calls.filter((call) =>
			call.path.includes("/attention/"),
		)) {
			expect(call.init.method).toBe("POST");
			expect(call.init.credentials).toBe("same-origin");
			expect(call.init.cache).toBe("no-store");
			expect(
				(call.init.headers as Record<string, string>)["x-jedv-mobile-csrf"],
			).toBe(session.csrfToken);
			expect(JSON.parse(String(call.init.body)).groupKey).toBe(group.groupKey);
		}
		expect(
			f.calls.some((call) => /ack|resolve|butler\/send/.test(call.path)),
		).toBe(false);
	} finally {
		f.dispose();
	}
});
test.each([
	401, 403, 500,
])("Attention HTTP %s never changes disposition, ACKs or auto-retries", async (status) => {
	let posts = 0;
	const f = await fixture((path) => {
		if (path.startsWith("/mobile/api/inbox?"))
			return json({
				groups: [attentionGroup],
				approvals: [],
				badge: { count: 1, pendingApprovals: 0, unreadHighFaultGroups: 1 },
			});
		if (path.endsWith("/attention/ignore")) {
			posts++;
			return json({ error: "Refused" }, status);
		}
		return undefined as never;
	});
	try {
		f.app.actions.screen("inbox");
		await f.app.actions.ignoreAttention(f.app.state.groups[0], "Test");
		expect(posts).toBe(1);
		if (status === 401) {
			expect(f.app.state.phase).toBe("pair");
			expect(f.app.state.groups).toEqual([]);
			expect(f.app.state.badge).toBeNull();
			expect(
				f.window.document.querySelector("article[data-group-key]"),
			).toBeNull();
		} else {
			expect(f.app.state.groups[0].disposition).toBe("open");
			expect(f.app.state.uncertainAttention.has(attentionGroup.groupKey)).toBe(
				true,
			);
			await f.app.actions.ignoreAttention(attentionGroup);
			await f.app.actions.refresh(false);
			expect(posts).toBe(1);
			expect(f.app.state.uncertainAttention.has(attentionGroup.groupKey)).toBe(
				true,
			);
			f.window.dispatchEvent(new f.window.Event("offline"));
			await f.app.actions.markAttentionRead(attentionGroup);
			f.window.dispatchEvent(new f.window.Event("online"));
			await f.app.actions.refresh(false);
			expect(posts).toBe(1);
			await f.app.actions.refresh(true);
			expect(f.app.state.uncertainAttention.has(attentionGroup.groupKey)).toBe(
				false,
			);
			expect(posts).toBe(1);
		}
		expect(
			f.calls.some((call) => /ack|resolve|butler\/send/.test(call.path)),
		).toBe(false);
	} finally {
		f.dispose();
	}
});
test("legacy alerts without groups never silently become current Attention cards", async () => {
	const f = await fixture((path) =>
		path.startsWith("/mobile/api/inbox?")
			? json({
					alerts: [
						{
							id: "legacy-id",
							subject: "Legacy-only",
							body: "old unread filtering",
						},
					],
					approvals: [],
				})
			: (undefined as never),
	);
	try {
		f.app.actions.screen("inbox");
		expect(f.app.state.attentionReady).toBe(false);
		expect(
			f.window.document.querySelector("article[data-group-key]"),
		).toBeNull();
		expect(
			f.window.document.querySelector(".banner.error")?.textContent,
		).toContain(mobileCatalogs().en?.attentionUnavailable);
		expect(f.window.document.querySelector("main")?.textContent).not.toContain(
			"Legacy-only",
		);
	} finally {
		f.dispose();
	}
});

test.each([
	{
		status: "executed",
		expiresAt: 1,
		effective: "executed",
		showExpiry: false,
	},
	{
		status: "rejected",
		expiresAt: 1,
		effective: "rejected",
		showExpiry: false,
	},
	{ status: "pending", expiresAt: 1, effective: "expired", showExpiry: true },
	{
		status: "pending",
		expiresAt: 2000,
		effective: "pending",
		showExpiry: true,
	},
	{
		status: "expired",
		expiresAt: 2000,
		effective: "expired",
		showExpiry: true,
	},
])("approval final status stays authoritative after its old expiry: %s", async (value) => {
	const record = {
		...card,
		status: value.status,
		expiresAt: value.expiresAt,
		summary: "Stop Team raw-uuid-only-in-details",
	};
	const f = await fixture(
		(path) =>
			path.includes("/approvals?") ? json([record]) : (undefined as never),
		{ clock: () => 1000 },
	);
	try {
		await f.app.actions.thread("thread");
		const node = f.window.document.querySelector("article[data-approval-id]");
		expect(node.querySelector(".badge")?.textContent).toBe(
			mobileCatalogs().en?.[value.effective],
		);
		expect(!!node.querySelector(".meta")).toBe(value.showExpiry);
		if (value.effective === "expired")
			expect(node.querySelector(".meta").textContent).toBe(
				f
					.createTranslator(f.window.document, f.window.navigator)
					.t("expiredAt", {
						time: f
							.createTranslator(f.window.document, f.window.navigator)
							.time(value.expiresAt),
					}),
			);
		const visible = node.cloneNode(true);
		for (const details of visible.querySelectorAll("details")) details.remove();
		expect(visible.textContent).toContain("Fixture");
		expect(visible.textContent).not.toContain("raw-uuid");
		expect(node.querySelector("details.audit")?.textContent).toContain(
			"raw-uuid",
		);
		if (value.status === "executed" || value.status === "rejected")
			expect(node.querySelector(".actions")).toBeNull();
	} finally {
		f.dispose();
	}
});

test("approval target uses payload Team identity and cached real status shape, with short ID only when no name exists", async () => {
	let stopped = false;
	const teamId = "4c89cdbf-2928-4bfb-a404-60fe6dbb28b2",
		record = {
			...card,
			targetId: teamId,
			payload: { actionType: "stopTeam", teamId },
			summary: "Stop Team " + teamId,
			status: "executed",
			expiresAt: 1,
		};
	const f = await fixture((path) => {
		if (path.endsWith("/status"))
			return json({
				teams: stopped
					? []
					: [
							{
								id: teamId,
								name: "新任务直接启动 · GUI 验收",
								goal: "",
								status: "paused",
								members: [],
							},
						],
				automations: [],
			});
		if (path.includes("/approvals?")) return json([record]);
		return undefined as never;
	});
	try {
		await f.app.actions.thread("thread");
		expect(
			f.window.document.querySelector("article[data-approval-id] .card-body")
				?.textContent,
		).toContain("新任务直接启动 · GUI 验收");
		stopped = true;
		await f.app.actions.refresh(true);
		expect(f.app.state.status.teams).toHaveLength(0);
		expect(
			f.window.document.querySelector("article[data-approval-id] .card-body")
				?.textContent,
		).toContain("新任务直接启动 · GUI 验收");
		f.app.state.knownTeams = [];
		f.app.actions.screen("butler");
		const node = f.window.document.querySelector("article[data-approval-id]");
		expect(node.querySelector(".card-body")?.textContent).toContain(
			"4c89cdbf…",
		);
		expect(node.querySelector(".card-body")?.textContent).not.toContain(
			mobileCatalogs().en?.stopTeam,
		);
		expect(node.querySelector("details")?.textContent).toContain(teamId);
	} finally {
		f.dispose();
	}
});
