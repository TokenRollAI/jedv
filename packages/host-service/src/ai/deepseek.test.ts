import { expect, test } from "bun:test";
import {
	mkdtempSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL, DeepseekClient } from "./deepseek";
import { DeepseekSecretStore } from "./secrets";

const fakeKey = () => "test-only-" + crypto.randomUUID();
const reply = (content: string) =>
	new Response(
		JSON.stringify({
			choices: [{ finish_reason: "stop", message: { content } }],
		}),
	);
const fakeFetch = (
	fn: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
) => fn as typeof fetch;
test("secret get only returns configured + mask; restricted atomic storage and clear", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "jedv-secret-")));
	const key = fakeKey();
	try {
		const store = new DeepseekSecretStore(() => root);
		expect(store.get()).toEqual({ configured: false, maskedHint: null });
		const status = store.setDeepseekKey(key);
		expect(status.configured).toBe(true);
		expect(JSON.stringify(status)).not.toContain(key);
		expect(status.maskedHint).toBe(`••••${key.slice(-4)}`);
		expect(statSync(join(root, "secrets/deepseek.key")).mode & 0o777).toBe(
			0o600,
		);
		expect(statSync(join(root, "secrets")).mode & 0o777).toBe(0o700);
		expect(store.readKey()).toBe(key);
		expect(() => store.setDeepseekKey("bad\nkey")).toThrow();
		store.setDeepseekKey(null);
		expect(store.get().configured).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
test("symlink secret storage is not followed", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "jedv-secret-")));
	try {
		symlinkSync("/tmp", join(root, "secrets"));
		const store = new DeepseekSecretStore(() => root);
		expect(store.readKey()).toBeNull();
		expect(() => store.setDeepseekKey(fakeKey())).toThrow();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
test("no key and oversized request skip fetch", async () => {
	let calls = 0;
	const fetcher = fakeFetch(async () => {
		calls++;
		throw new Error("must not fetch");
	});
	expect(
		await new DeepseekClient({ readKey: () => null, fetch: fetcher }).complete([
			{ role: "user", content: "hello" },
		]),
	).toEqual({ content: null, reason: "no_key" });
	expect(
		(
			await new DeepseekClient({ readKey: fakeKey, fetch: fetcher }).complete([
				{ role: "user", content: "x".repeat(32001) },
			])
		).reason,
	).toBe("budget");
	expect(calls).toBe(0);
});
test("fake request pins official URL, model, no redirects and response contract", async () => {
	const key = fakeKey();
	let calls = 0;
	const client = new DeepseekClient({
		readKey: () => key,
		fetch: fakeFetch(async (url, init) => {
			calls++;
			expect(url).toBe(DEEPSEEK_ENDPOINT);
			expect(init?.redirect).toBe("error");
			expect((init?.headers as Record<string, string>).Authorization).toBe(
				`Bearer ${key}`,
			);
			const body = JSON.parse(String(init?.body));
			expect(body.model).toBe(DEEPSEEK_MODEL);
			expect(body.model).toBe("deepseek-flash");
			expect(body.stream).toBe(false);
			expect(body).not.toHaveProperty("tools");
			expect(JSON.stringify(body)).not.toContain(key);
			return reply("ok");
		}),
	});
	expect(await client.complete([{ role: "user", content: "hello" }])).toEqual({
		content: "ok",
		reason: null,
	});
	expect(calls).toBe(1);
});
test("upstream errors, malformed/oversized output and key echo degrade without leaks", async () => {
	const key = fakeKey();
	for (const fetcher of [
		fakeFetch(async () => {
			throw new Error(key);
		}),
		fakeFetch(async () => new Response(key, { status: 429 })),
		fakeFetch(async () => reply(key)),
		fakeFetch(async () => new Response("invalid")),
		fakeFetch(async () => reply("x".repeat(16001))),
	]) {
		const result = await new DeepseekClient({
			readKey: () => key,
			fetch: fetcher,
		}).complete([{ role: "user", content: "x" }]);
		expect(result).toEqual({ content: null, reason: "unavailable" });
		expect(JSON.stringify(result)).not.toContain(key);
	}
});
test("timeout is cancellable and tested with manual scheduler, no sleep", async () => {
	let fire = () => {};
	let cancelled = 0;
	let signal: AbortSignal | undefined;
	const client = new DeepseekClient({
		readKey: fakeKey,
		fetch: fakeFetch(async (_url, init) => {
			signal = init?.signal ?? undefined;
			return new Promise(() => {});
		}),
		scheduleTimeout: (fn, ms) => {
			expect(ms).toBe(12000);
			fire = fn;
			return () => {
				cancelled++;
			};
		},
	});
	const result = client.complete([{ role: "user", content: "hello" }]);
	fire();
	expect(await result).toEqual({ content: null, reason: "unavailable" });
	expect(signal?.aborted).toBe(true);
	expect(cancelled).toBe(1);
});
test("JSON extraction pins disabled thinking and rejects length/blank responses", async () => {
	let requests = 0;
	const client = new DeepseekClient({
		readKey: fakeKey,
		fetch: fakeFetch(async (_url, init) => {
			const body = JSON.parse(String(init?.body));
			expect(body.thinking).toEqual({ type: "disabled" });
			expect(body.max_tokens).toBe(1500);
			expect(body.response_format).toEqual({ type: "json_object" });
			expect(body.messages[0].content).toContain("JSON");
			requests++;
			return requests === 1
				? new Response(
						JSON.stringify({
							choices: [
								{
									finish_reason: "length",
									message: { content: '{"entries":[]}' },
								},
							],
						}),
					)
				: reply("   \n ");
		}),
	});
	for (let i = 0; i < 2; i++)
		expect(
			await client.complete(
				[
					{ role: "system", content: "Return JSON only" },
					{ role: "user", content: "extract" },
				],
				{ json: true },
			),
		).toEqual({ content: null, reason: "unavailable" });
	expect(requests).toBe(2);
});
test("dispose cancels pending requests without waiting for timeout", async () => {
	let cancelled = 0;
	const client = new DeepseekClient({
		readKey: fakeKey,
		fetch: fakeFetch(async () => new Promise(() => {})),
		scheduleTimeout: () => () => {
			cancelled++;
		},
	});
	const pending = client.complete([{ role: "user", content: "hello" }]);
	client.dispose();
	expect(await pending).toEqual({ content: null, reason: "unavailable" });
	expect(cancelled).toBe(1);
	expect(await client.complete([{ role: "user", content: "later" }])).toEqual({
		content: null,
		reason: "unavailable",
	});
});
