import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { AppUpdater, UpdateCheckResult } from "electron-updater";
import { AutoUpdaterRuntime, type AutoUpdaterRuntimeOptions } from "./runtime";

class FixtureUpdater extends EventEmitter {
	checks = 0;
	installs = 0;
	clears = 0;
	autoInstallOnAppQuit = true;
	autoDownload = false;
	feed: unknown;
	failure: Error | null = null;
	result: UpdateCheckResult | null = {} as UpdateCheckResult;
	checkEvent = "update-available";
	downloadedUpdateHelper = {
		clear: async () => {
			this.clears++;
		},
	};
	setFeedURL(feed: unknown) {
		this.feed = feed;
	}
	async checkForUpdates() {
		this.checks++;
		if (this.failure) throw this.failure;
		if (this.result)
			this.emit(this.checkEvent, {
				version: this.checkEvent === "update-available" ? "2.0.9" : "2.0.8",
			});
		return this.result;
	}
	quitAndInstall() {
		this.installs++;
		if (this.failure) throw this.failure;
	}
}

function fixture(overrides: Partial<AutoUpdaterRuntimeOptions> = {}) {
	const updater = new FixtureUpdater();
	let recoveries = 0;
	let cancel: (() => void) | undefined;
	const persisted: string[] = [];
	const runtime = new AutoUpdaterRuntime({
		updater: updater as unknown as AppUpdater,
		version: "2.0.8",
		platform: "darwin",
		packaged: true,
		development: false,
		metadataExists: () => true,
		disabledByEnvironment: () => false,
		verifySignature: async () => true,
		freeBytes: () => 4 * 1024 ** 3,
		persistVersion: async (version) => {
			persisted.push(version);
		},
		confirmInstall: async () => true,
		prepareInstall: async () => true,
		installFailed: () => {
			recoveries++;
		},
		observeQuitCancellation: (callback) => {
			cancel = callback;
			return () => {
				cancel = undefined;
			};
		},
		logger: { info() {}, warn() {}, error() {} },
		...overrides,
	});
	runtime.start(false);
	return {
		updater,
		runtime,
		persisted,
		recoveries: () => recoveries,
		cancel: () => cancel?.(),
	};
}

test("SDK update events retain real progress, ready state and a single concurrent check", async () => {
	const h = fixture();
	try {
		const first = h.runtime.check();
		expect(h.runtime.check()).toBe(first);
		await first;
		expect(h.updater.feed).toEqual({
			provider: "generic",
			url: "https://github.com/TokenRollAI/jedv/releases/latest/download",
		});
		expect(h.updater.autoDownload).toBe(true);
		expect(h.updater.autoInstallOnAppQuit).toBe(false);
		h.updater.emit("download-progress", {
			percent: 50,
			transferred: 20,
			total: 40,
		});
		expect(h.runtime.getStatus()).toMatchObject({
			status: "downloading",
			version: "2.0.9",
			progress: { percent: 50, transferredBytes: 20, totalBytes: 40 },
		});
		h.updater.emit("update-downloaded", { version: "2.0.9" });
		expect(h.runtime.getStatus().status).toBe("ready");
		h.runtime.dismiss();
		expect(h.runtime.getStatus().status).toBe("idle");
		expect((await h.runtime.check()).status).toBe("ready");
		expect(h.updater.checks).toBe(1);
	} finally {
		h.runtime.dispose();
	}
});

test("missing prerequisites are distinct and never up to date", async () => {
	for (const [options, availability] of [
		[{ development: true }, "development"],
		[{ packaged: false }, "unpackaged"],
		[{ metadataExists: () => false }, "missing-metadata"],
		[{ disabledByEnvironment: () => true }, "disabled-environment"],
	] as const) {
		const h = fixture(options);
		try {
			const state = await h.runtime.check();
			expect(state.availability).toBe(availability);
			expect(state.checkOutcome).not.toBe("up-to-date");
			expect(h.updater.checks).toBe(0);
		} finally {
			h.runtime.dispose();
		}
	}
});

test("unsigned builds check releases without downloading or installing and can retry", async () => {
	const h = fixture({
		verifySignature: async () => false,
		freeBytes: () => 1024,
	});
	try {
		expect(await h.runtime.check()).toMatchObject({
			availability: "unsigned",
			status: "idle",
			checkOutcome: "update-available",
			version: "2.0.9",
		});
		expect(h.updater.autoDownload).toBe(false);
		h.updater.emit("update-downloaded", { version: "2.0.9" });
		expect(await h.runtime.install()).toEqual({ started: false });
		expect(h.updater.installs).toBe(0);
		h.updater.failure = new Error("ECONNREFUSED");
		expect(await h.runtime.check()).toMatchObject({
			status: "error",
			checkOutcome: "failed",
		});
		h.updater.failure = null;
		h.updater.checkEvent = "update-not-available";
		expect(await h.runtime.check()).toMatchObject({
			availability: "unsigned",
			checkOutcome: "up-to-date",
		});
		expect(h.updater.checks).toBe(3);
	} finally {
		h.runtime.dispose();
	}
});

test("404 feed errors remain visible and retry succeeds only on the SDK no-update event", async () => {
	const h = fixture();
	try {
		h.updater.failure = new Error(
			"HttpError 404 for https://example.test/latest-mac.yml?token=secret",
		);
		expect(await h.runtime.check()).toMatchObject({
			status: "error",
			errorKind: "feed",
			checkOutcome: "failed",
		});
		expect(h.runtime.getStatus().error).not.toContain("secret");
		h.updater.failure = null;
		h.updater.checkEvent = "update-not-available";
		expect(await h.runtime.check()).toMatchObject({
			status: "idle",
			checkOutcome: "up-to-date",
		});
		h.updater.result = null;
		expect((await h.runtime.check()).checkOutcome).toBe("failed");
	} finally {
		h.runtime.dispose();
	}
});

test("offline checks and low disk space never claim a successful version check", async () => {
	const h = fixture();
	const low = fixture({ freeBytes: () => 1024 });
	try {
		h.updater.failure = new Error("ECONNREFUSED");
		expect(await h.runtime.check()).toMatchObject({
			status: "error",
			errorKind: "network",
			checkOutcome: "failed",
		});
		expect(await low.runtime.check()).toMatchObject({
			status: "error",
			errorKind: "disk-space",
			checkOutcome: "failed",
		});
		expect(low.updater.checks).toBe(0);
	} finally {
		h.runtime.dispose();
		low.runtime.dispose();
	}
});

test("cancelled unsaved-window preparation never calls the native installer", async () => {
	const h = fixture({ prepareInstall: async () => false });
	try {
		await h.runtime.check();
		h.updater.emit("update-downloaded", { version: "2.0.9" });
		expect(await h.runtime.install()).toEqual({ started: false });
		expect(h.runtime.getStatus()).toMatchObject({
			status: "ready",
			installing: false,
		});
		expect(h.updater.installs).toBe(0);
	} finally {
		h.runtime.dispose();
	}
});

test("explicit install deduplicates requests and an install failure clears its SDK cache", async () => {
	const h = fixture();
	try {
		await h.runtime.check();
		h.updater.emit("update-downloaded", { version: "2.0.9" });
		const first = h.runtime.install();
		expect(await h.runtime.install()).toEqual({ started: false });
		expect(await first).toEqual({ started: true });
		expect(h.updater.installs).toBe(1);
		h.cancel();
		expect(h.runtime.getStatus()).toMatchObject({
			status: "ready",
			installing: false,
		});
		h.updater.failure = new Error(
			"Code signature did not pass validation at /Users/secret/cache",
		);
		expect(await h.runtime.install()).toEqual({ started: false });
		expect(h.runtime.getStatus()).toMatchObject({
			status: "error",
			errorKind: "signature",
			installing: false,
		});
		expect(h.updater.clears).toBe(1);
		expect(h.recoveries()).toBe(1);
		expect(h.runtime.getStatus().error).not.toContain("/Users/secret");
	} finally {
		h.runtime.dispose();
	}
});

test("a changed installed version is persisted and dispose removes SDK listeners", () => {
	const h = fixture({ lastRunVersion: "2.0.7" });
	expect(h.runtime.getStatus()).toMatchObject({
		status: "updated",
		version: "2.0.8",
	});
	expect(h.persisted).toEqual(["2.0.8"]);
	h.runtime.dispose();
	expect(h.updater.listenerCount("error")).toBe(0);
	expect(h.updater.listenerCount("download-progress")).toBe(0);
});
