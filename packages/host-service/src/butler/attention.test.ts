import { expect, test } from "bun:test";
import { Hono } from "hono";
import { DeepseekClient } from "../ai/deepseek";
import { RuleWatchdog } from "../watchdog/service";
import { registerButlerHttp } from "./http";
import { ButlerService } from "./service";
import { butlerFixture } from "./test-fixture";

test("Attention counts every pending approval and high fault group beyond page limits, without reading a Key or calling a model", async () => {
	const f = butlerFixture();
	const dog = new RuleWatchdog({
		db: f.sqlite,
		snapshot: () => ({ members: [], mail: [], automationRuns: [] }),
	});
	const ai = new DeepseekClient({
		readKey: () => {
			throw new Error("Attention must not inspect credentials");
		},
		fetch: async () => {
			throw new Error("Attention must not call a model");
		},
	});
	const service = new ButlerService({
		db: f.sqlite,
		tools: f.tools,
		ai,
		now: () => 1000000,
		watchdog: dog,
	});
	try {
		const insert = f.sqlite.prepare(
			"INSERT INTO watchdog_alerts(id,dedupe_key,group_key,severity,kind,subject,body,created_at) VALUES(?,?,?,'high','automation_failed','Failed','fixture',?)",
		);
		for (let i = 0; i < 101; i++)
			insert.run(`alert-${i}`, `failure-${i}`, `automation_failed:${i}`, i);
		insert.run("repeat", "repeat", "automation_failed:0", 500);
		f.sqlite
			.prepare(
				"INSERT INTO watchdog_alerts(id,dedupe_key,group_key,severity,kind,subject,body,created_at) VALUES('soft','soft','mail_unacked:team:member','normal','mail_unacked','Reminder','Unacked',501)",
			)
			.run();
		const memory = f.memory.runtime.memory.put({
			scopeKind: "global",
			title: "Attention fixture",
			content: "Keep until separately approved",
		});
		for (let i = 0; i < 105; i++)
			service.requestApproval({
				requestId: `request-${i}`,
				humanText: "Retire the fixture only after confirmation",
				action: { actionType: "deleteMemoryBatch", memoryIds: [memory.id] },
			});
		const result = await service.attention({ limit: 1 });
		expect(result.groups).toHaveLength(1);
		expect(result.approvals).toHaveLength(1);
		expect(result.badge).toEqual({
			pendingApprovals: 105,
			unreadHighFaultGroups: 101,
			count: 206,
		});
		expect(result).not.toHaveProperty("overview");
		expect(result).not.toHaveProperty("aiConfigured");
		expect(result.approvals[0]?.source).toMatchObject({
			kind: "memory",
			terminalLive: false,
			fallback: "memory",
		});
		const read = service.markAttentionRead({ groupKey: "automation_failed:0" });
		expect(read).toMatchObject({
			updatedCount: 2,
			badge: { pendingApprovals: 105, unreadHighFaultGroups: 100, count: 205 },
		});
		expect(
			(await service.attention()).groups.some(
				(group) => group.groupKey === "automation_failed:0",
			),
		).toBe(true);
		const ignored = service.ignoreAttention({
			groupKey: "automation_failed:1",
			reason: "Known failure",
		});
		expect(ignored).toMatchObject({
			updatedCount: 1,
			disposition: "ignored",
			badge: { count: 204 },
		});
		expect((await service.attention({ view: "handled" })).groups).toMatchObject(
			[{ groupKey: "automation_failed:1", disposition: "ignored" }],
		);
		expect(f.memory.runtime.memory.get(memory.id).status).toBe("active");
	} finally {
		await service.dispose();
		await dog.dispose();
		await f.dispose();
	}
});

test("HTTP attention/read/ignore preserve structured targets and use the same local service", async () => {
	const f = butlerFixture();
	try {
		f.sqlite
			.prepare(
				"INSERT INTO watchdog_alerts(id,dedupe_key,group_key,severity,kind,subject,body,team_id,member_id,workspace_id,terminal_id,created_at) VALUES('alert','event','team_attention:team:member','high','team_attention','Needs reconciliation','not an ID source','team','member','ended-workspace','ended-terminal',1)",
			)
			.run();
		const app = new Hono();
		const openapi = registerButlerHttp({
			app,
			butler: f.service,
			authenticate: (request) =>
				request.headers.get("Authorization") === "Bearer fixture",
		});
		expect(openapi.paths["/api/v1/butler/attention/read"]).toBeTruthy();
		const get = await app.request("/api/v1/butler/attention?limit=1", {
			headers: { Authorization: "Bearer fixture" },
		});
		expect(get.status).toBe(200);
		const attention = (await get.json()) as Awaited<
			ReturnType<ButlerService["attention"]>
		>;
		expect(attention.groups[0]?.source).toMatchObject({
			teamId: "team",
			memberId: "member",
			terminalId: "ended-terminal",
			terminalLive: false,
		});
		const post = (path: string, body: unknown, auth = true) =>
			app.request(`/api/v1/butler/attention/${path}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(auth ? { Authorization: "Bearer fixture" } : {}),
				},
				body: JSON.stringify(body),
			});
		expect((await post("read", { alertId: "alert" }, false)).status).toBe(401);
		expect(
			(await post("read", { alertId: "alert", groupKey: "group" })).status,
		).toBe(400);
		expect(
			await (await post("read", { alertId: "alert" })).json(),
		).toMatchObject({ updatedCount: 1, badge: { count: 0 } });
		expect(
			await (
				await post("ignore", { alertId: "alert", reason: "Known" })
			).json(),
		).toMatchObject({
			updatedCount: 1,
			disposition: "ignored",
			badge: { count: 0 },
		});
		const inbox = (await (
			await app.request("/api/v1/butler/inbox?view=handled", {
				headers: { Authorization: "Bearer fixture" },
			})
		).json()) as Awaited<ReturnType<ButlerService["inbox"]>>;
		expect(inbox.groups).toHaveLength(1);
		expect(Array.isArray(inbox.alerts)).toBe(true);
		expect(
			f.sqlite
				.prepare(
					"SELECT resolved_at AS resolvedAt,ignore_reason AS reason FROM watchdog_alerts WHERE id='alert'",
				)
				.get(),
		).toEqual({ resolvedAt: null, reason: "Known" });
	} finally {
		await f.dispose();
	}
});
