import { EventEmitter } from "node:events";
import type { AppUpdater, UpdateCheckResult } from "electron-updater";
import { gt, prerelease, valid } from "semver";
import {
	AUTO_UPDATE_STATUS,
	type AutoUpdateStatusEvent,
	type AutoUpdateVersionInfo,
} from "shared/auto-update";
import {
	JEDV_CANARY_UPDATE_FEED_URL,
	JEDV_RELEASES_URL,
	JEDV_REPOSITORY_URL,
	JEDV_UPDATE_FEED_URL,
} from "shared/jedv";
import {
	isEnvironmentUpdateError,
	isUpstreamServerError,
	UPDATE_STAGING_MIN_FREE_BYTES,
} from "../update-error-classification";
import { redactUpdateErrorMessage } from "../update-error-redaction";

export interface AutoUpdaterRuntimeOptions {
	updater: AppUpdater;
	version: string;
	platform: NodeJS.Platform;
	packaged: boolean;
	development: boolean;
	metadataExists: () => boolean;
	disabledByEnvironment: () => boolean;
	verifySignature: () => Promise<boolean>;
	freeBytes: () => number | null;
	lastRunVersion?: string;
	persistVersion: (version: string) => Promise<void>;
	confirmInstall: () => Promise<boolean>;
	prepareInstall: () => Promise<boolean>;
	installFailed: () => void;
	observeQuitCancellation: (cancel: () => void) => () => void;
	logger: {
		info(message: string): void;
		warn(message: string): void;
		error(message: string): void;
	};
}

export class AutoUpdaterRuntime extends EventEmitter {
	private state: AutoUpdateStatusEvent;
	private dismissed = false;
	private started = false;
	private disposed = false;
	private checking: Promise<AutoUpdateStatusEvent> | null = null;
	private installRequested = false;
	private detachCancellation: (() => void) | undefined;
	private interval: ReturnType<typeof setInterval> | undefined;
	private firstCheck: ReturnType<typeof setTimeout> | undefined;
	private lastProgressAt = 0;
	private eventListeners: Array<{
		event: string;
		listener: (...args: unknown[]) => void;
	}> = [];

	constructor(private readonly options: AutoUpdaterRuntimeOptions) {
		super();
		this.state = {
			status: AUTO_UPDATE_STATUS.IDLE,
			currentVersion: options.version,
			releasesUrl: JEDV_RELEASES_URL,
			channel: prerelease(options.version) ? "canary" : "stable",
			availability: "supported",
			checkOutcome: "not-checked",
			installing: false,
		};
		this.refreshAvailability();
	}

	versionInfo(): AutoUpdateVersionInfo {
		return {
			currentVersion: this.options.version,
			repositoryUrl: JEDV_REPOSITORY_URL,
			releasesUrl: JEDV_RELEASES_URL,
			feedUrl:
				this.state.channel === "canary"
					? JEDV_CANARY_UPDATE_FEED_URL
					: JEDV_UPDATE_FEED_URL,
			channel: this.state.channel,
			packaged: this.options.packaged,
			platform: this.options.platform,
		};
	}

	getStatus(): AutoUpdateStatusEvent {
		return {
			...this.state,
			...(this.dismissed &&
			this.state.status === AUTO_UPDATE_STATUS.READY &&
			!this.state.installing
				? { status: AUTO_UPDATE_STATUS.IDLE }
				: {}),
		};
	}

	isInstalling(): boolean {
		return this.state.installing;
	}
	isReady(): boolean {
		return (
			this.state.installing || this.state.status === AUTO_UPDATE_STATUS.READY
		);
	}

	private emitState(patch: Partial<AutoUpdateStatusEvent>): void {
		if (this.disposed) return;
		this.state = { ...this.state, ...patch };
		this.emit("status-changed", this.getStatus());
	}

	private refreshAvailability(): void {
		const options = this.options;
		const availability = options.development
			? "development"
			: !options.packaged
				? "unpackaged"
				: !["darwin", "linux", "win32"].includes(options.platform)
					? "unsupported-platform"
					: options.disabledByEnvironment()
						? "disabled-environment"
						: !options.metadataExists()
							? "missing-metadata"
							: "supported";
		const reasons: Record<typeof availability, string | undefined> = {
			supported: undefined,
			development: "Auto-updates are disabled in development mode.",
			unpackaged:
				"Auto-updates require an installed, packaged Jedv application.",
			"unsupported-platform":
				"This platform does not support Jedv automatic updates.",
			"disabled-environment":
				"Auto-updates are disabled by DISABLE_UPDATE_CHECK.",
			"missing-metadata":
				"This build has no app-update.yml. Install a Jedv release with update metadata.",
		};
		this.state = { ...this.state, availability, reason: reasons[availability] };
	}

	start(automaticChecks = true): void {
		if (this.started || this.disposed) return;
		this.started = true;
		const updater = this.options.updater;
		updater.autoDownload = true;
		updater.autoInstallOnAppQuit = false;
		updater.disableDifferentialDownload = true;
		updater.allowDowngrade = false;
		updater.allowPrerelease = this.state.channel === "canary";
		updater.logger = {
			info: (message: unknown) =>
				this.options.logger.info(redactUpdateErrorMessage(String(message))),
			warn: (message: unknown) =>
				this.options.logger.warn(redactUpdateErrorMessage(String(message))),
			error: (message: unknown) =>
				this.options.logger.error(redactUpdateErrorMessage(String(message))),
		};
		updater.setFeedURL({
			provider: "generic",
			url: this.versionInfo().feedUrl,
		});
		this.listen("error", (error: Error) => {
			void this.fail(error);
		});
		this.listen("checking-for-update", () =>
			this.emitState({ status: AUTO_UPDATE_STATUS.CHECKING }),
		);
		this.listen("update-available", (info: { version: string }) => {
			if (!valid(info.version) || !gt(info.version, this.options.version)) {
				void this.fail(
					new Error(
						"The update feed returned an invalid or non-newer release version.",
					),
				);
				return;
			}
			this.dismissed = false;
			this.emitState({
				status: AUTO_UPDATE_STATUS.DOWNLOADING,
				version: info.version,
				error: undefined,
				errorKind: undefined,
				checkOutcome: "update-available",
				checkedAt: Date.now(),
			});
		});
		this.listen("update-not-available", (info: { version: string }) => {
			if (!valid(info.version)) {
				void this.fail(new Error("Cannot parse update info version."));
				return;
			}
			this.emitState({
				status: AUTO_UPDATE_STATUS.IDLE,
				version: undefined,
				error: undefined,
				errorKind: undefined,
				progress: undefined,
				checkOutcome: "up-to-date",
				checkedAt: Date.now(),
			});
		});
		this.listen(
			"download-progress",
			(progress: { percent: number; transferred: number; total: number }) => {
				const now = Date.now();
				if (now - this.lastProgressAt < 500 && progress.percent < 100) return;
				this.lastProgressAt = now;
				if (
					![progress.percent, progress.transferred, progress.total].every(
						Number.isFinite,
					)
				)
					return;
				this.emitState({
					status: AUTO_UPDATE_STATUS.DOWNLOADING,
					progress: {
						percent: Math.max(0, Math.min(100, progress.percent)),
						transferredBytes: Math.max(0, progress.transferred),
						totalBytes: Math.max(0, progress.total),
					},
				});
			},
		);
		this.listen("update-downloaded", (info: { version: string }) => {
			this.dismissed = false;
			this.emitState({
				status: AUTO_UPDATE_STATUS.READY,
				version: info.version,
				progress: undefined,
				checkOutcome: "update-available",
			});
		});
		const changed =
			!!this.options.lastRunVersion &&
			this.options.lastRunVersion !== this.options.version;
		if (
			this.options.packaged &&
			this.options.lastRunVersion !== this.options.version
		) {
			if (changed)
				this.emitState({
					status: AUTO_UPDATE_STATUS.UPDATED,
					version: this.options.version,
				});
			void this.options
				.persistVersion(this.options.version)
				.catch((error) =>
					this.options.logger.warn(redactUpdateErrorMessage(String(error))),
				);
		}
		if (automaticChecks && this.state.availability === "supported") {
			this.interval = setInterval(
				() => {
					void this.check();
				},
				4 * 60 * 60 * 1000,
			);
			this.interval.unref?.();
			this.firstCheck = setTimeout(
				() => {
					void this.check();
				},
				changed ? 10_000 : 0,
			);
			this.firstCheck.unref?.();
		}
	}

	private listen<Args extends unknown[]>(
		event: string,
		listener: (...args: Args) => void,
	): void {
		(this.options.updater as EventEmitter).on(event, listener);
		this.eventListeners.push({
			event,
			listener: listener as unknown as (...args: unknown[]) => void,
		});
	}

	check(): Promise<AutoUpdateStatusEvent> {
		if (this.checking) return this.checking;
		if (this.disposed) return Promise.resolve(this.getStatus());
		this.start(false);
		this.dismissed = false;
		if (this.isReady()) {
			this.emitState({});
			return Promise.resolve(this.getStatus());
		}
		this.refreshAvailability();
		if (this.state.availability !== "supported") {
			this.emitState({ checkOutcome: "not-checked" });
			return Promise.resolve(this.getStatus());
		}
		this.checking = this.performCheck().finally(() => {
			this.checking = null;
		});
		return this.checking;
	}

	private async performCheck(): Promise<AutoUpdateStatusEvent> {
		this.emitState({
			status: AUTO_UPDATE_STATUS.CHECKING,
			error: undefined,
			errorKind: undefined,
			progress: undefined,
			version: undefined,
			checkOutcome: "not-checked",
		});
		try {
			if (!(await this.options.verifySignature())) {
				this.emitState({
					status: AUTO_UPDATE_STATUS.ERROR,
					availability: "unsigned",
					reason:
						"This macOS build has no verified signing identity. Install a signed Jedv release.",
					errorKind: "signature",
					checkOutcome: "failed",
				});
				return this.getStatus();
			}
			if (this.disposed) return this.getStatus();
			const free = this.options.freeBytes();
			if (free !== null && free < UPDATE_STAGING_MIN_FREE_BYTES)
				throw new Error(
					"ENOSPC: insufficient free space for the Jedv updater cache",
				);
			const result: UpdateCheckResult | null =
				await this.options.updater.checkForUpdates();
			result?.downloadPromise?.catch((error) => {
				void this.fail(error);
			});
			if (!result && this.state.status === AUTO_UPDATE_STATUS.CHECKING)
				throw new Error(
					"No update feed result was returned; no version was verified.",
				);
			if (result && this.state.status === AUTO_UPDATE_STATUS.CHECKING)
				throw new Error(
					"The updater did not confirm a release or a no-update result.",
				);
		} catch (error) {
			await this.fail(error);
		}
		return this.getStatus();
	}

	private async fail(value: unknown): Promise<void> {
		if (this.disposed) return;
		const original = value instanceof Error ? value : new Error(String(value));
		const message = redactUpdateErrorMessage(original.message).slice(0, 2000);
		if (
			this.state.status === AUTO_UPDATE_STATUS.ERROR &&
			this.state.error === message
		)
			return;
		const free = this.options.freeBytes();
		const kind: AutoUpdateStatusEvent["errorKind"] =
			/code signature|codesign|not signed|signature/i.test(message)
				? "signature"
				: /404|cannot find channel|no update feed|no version was verified|no-update result|cannot parse update info|app-update\.yml/i.test(
							message,
						)
					? "feed"
					: /ENOSPC|insufficient free space/i.test(message) ||
							(free !== null &&
								free < UPDATE_STAGING_MIN_FREE_BYTES &&
								isEnvironmentUpdateError(message, free))
						? "disk-space"
						: /net::ERR_|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(
									message,
								) || isUpstreamServerError(original)
							? "network"
							: isEnvironmentUpdateError(message, free)
								? "environment"
								: /checksum|no files provided|invalid or non-newer/i.test(
											message,
										)
									? "release"
									: "unknown";
		const clear =
			this.state.installing ||
			this.state.status === AUTO_UPDATE_STATUS.DOWNLOADING ||
			kind === "signature" ||
			kind === "release";
		const installFailed = this.state.installing;
		this.installRequested = false;
		this.detachCancellation?.();
		this.detachCancellation = undefined;
		this.options.logger.error(`[auto-updater] ${kind}: ${message}`);
		this.emitState({
			status: AUTO_UPDATE_STATUS.ERROR,
			installing: false,
			error: message,
			errorKind: kind,
			checkOutcome: "failed",
			progress: undefined,
		});
		if (installFailed) this.options.installFailed();
		if (clear) {
			const helper = (
				this.options.updater as unknown as {
					downloadedUpdateHelper?: { clear(): Promise<void> };
				}
			).downloadedUpdateHelper;
			try {
				await helper?.clear();
			} catch (error) {
				this.options.logger.warn(redactUpdateErrorMessage(String(error)));
			}
		}
	}

	async install(): Promise<{ started: boolean }> {
		if (
			this.disposed ||
			this.installRequested ||
			this.isInstalling() ||
			this.state.status !== AUTO_UPDATE_STATUS.READY ||
			this.state.availability !== "supported"
		)
			return { started: false };
		this.installRequested = true;
		try {
			if (!(await this.options.confirmInstall())) return { started: false };
			if (!(await this.options.prepareInstall())) return { started: false };
			if (this.disposed || this.state.status !== AUTO_UPDATE_STATUS.READY)
				return { started: false };
			this.detachCancellation = this.options.observeQuitCancellation(() => {
				this.installRequested = false;
				this.detachCancellation?.();
				this.detachCancellation = undefined;
				this.emitState({ status: AUTO_UPDATE_STATUS.READY, installing: false });
			});
			this.emitState({ installing: true });
			this.options.updater.quitAndInstall(false, true);
			return { started: true };
		} catch (error) {
			await this.fail(error);
			return { started: false };
		} finally {
			if (!this.isInstalling()) this.installRequested = false;
		}
	}

	dismiss(): void {
		this.dismissed = true;
		this.emitState({});
	}

	dispose(): void {
		this.disposed = true;
		clearInterval(this.interval);
		clearTimeout(this.firstCheck);
		for (const { event, listener } of this.eventListeners)
			(this.options.updater as EventEmitter).removeListener(event, listener);
		this.eventListeners = [];
		this.detachCancellation?.();
		this.detachCancellation = undefined;
	}
}
