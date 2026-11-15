import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { mobilePublicAssets } from "./index";

test("Service Worker only intercepts exact public GETs and never API/session/chat/approval data", async () => {
	type WorkerEvent =
		| { waitUntil: (value: Promise<void>) => void }
		| { request: Request; respondWith: (value: Promise<Response>) => void };
	const handlers = new Map<string, (event: WorkerEvent) => void>(),
		stored = new Map<string, Response>(),
		fetches: Array<{ input: unknown; init?: RequestInit }> = [],
		deleted: string[] = [];
	const cache = {
		put: async (path: string, value: Response) => {
			stored.set(path, value);
		},
		match: async (path: string) => stored.get(path),
	};
	const self = {
		location: { origin: "https://phone.tail.ts.net" },
		addEventListener: (type: string, fn: (event: WorkerEvent) => void) =>
			handlers.set(type, fn),
		skipWaiting: async () => {},
		clients: { claim: async () => {} },
	};
	runInNewContext(
		String(
			mobilePublicAssets.find((a) => a.path.endsWith("service-worker.js"))
				?.content,
		),
		{
			self,
			URL,
			Request,
			Response,
			caches: {
				open: async () => cache,
				keys: async () => ["other-app-data", "jedv-mobile-static-old"],
				delete: async (name: string) => {
					deleted.push(name);
				},
			},
			fetch: async (input: unknown, init?: RequestInit) => {
				fetches.push({ input, init });
				return new Response("public static");
			},
		},
	);
	let installing = Promise.resolve();
	handlers.get("install")?.({
		waitUntil: (promise: Promise<void>) => {
			installing = promise;
		},
	});
	await installing;
	expect(fetches.length).toBe(mobilePublicAssets.length - 1);
	for (const call of fetches) {
		expect(String(call.input)).not.toStartWith("/mobile/api");
		expect(call.init?.credentials).toBe("omit");
	}
	expect(
		[...stored.keys()].every((path) => !path.startsWith("/mobile/api")),
	).toBe(true);
	let activate = Promise.resolve();
	handlers.get("activate")?.({
		waitUntil: (promise: Promise<void>) => {
			activate = promise;
		},
	});
	await activate;
	expect(deleted).toEqual(["jedv-mobile-static-old"]);
	for (const path of [
		"/mobile/api/session",
		"/mobile/api/butler/history?threadId=x",
		"/mobile/api/inbox",
		"/mobile/api/approvals/x/resolve",
		"/trpc/butler.sendMessage",
		"/mobile/not-public.js",
		"/mobile/app.js?csrf=private",
	]) {
		let intercepted = false;
		handlers.get("fetch")?.({
			request: new Request(`https://phone.tail.ts.net${path}`),
			respondWith: () => {
				intercepted = true;
			},
		});
		expect(intercepted).toBe(false);
	}
	let publicResponse: Promise<Response> | undefined;
	handlers.get("fetch")?.({
		request: new Request("https://phone.tail.ts.net/mobile/app.js"),
		respondWith: (value: Promise<Response>) => {
			publicResponse = value;
		},
	});
	expect(await (await publicResponse)?.text()).toBe("public static");
	let post = false;
	handlers.get("fetch")?.({
		request: new Request("https://phone.tail.ts.net/mobile/app.js", {
			method: "POST",
		}),
		respondWith: () => {
			post = true;
		},
	});
	expect(post).toBe(false);
	expect(handlers.has("sync")).toBe(false);
});
