export const AUTO_UPDATE_STATUS = {
	IDLE: "idle",
	CHECKING: "checking",
	DOWNLOADING: "downloading",
	READY: "ready",
	/** Transient: the app just relaunched on a new version after an install */
	UPDATED: "updated",
	ERROR: "error",
} as const;

export type AutoUpdateStatus =
	(typeof AUTO_UPDATE_STATUS)[keyof typeof AUTO_UPDATE_STATUS];

export interface AutoUpdateProgress {
	percent: number;
	transferredBytes: number;
	totalBytes: number;
}

export interface AutoUpdateStatusEvent {
	status: AutoUpdateStatus;
	version?: string;
	error?: string;
	progress?: AutoUpdateProgress;
	currentVersion: string;
	releasesUrl: string;
	channel: "stable" | "canary";
	availability:
		| "supported"
		| "development"
		| "unpackaged"
		| "unsupported-platform"
		| "disabled-environment"
		| "missing-metadata"
		| "unsigned";
	reason?: string;
	checkOutcome: "not-checked" | "up-to-date" | "update-available" | "failed";
	installing: boolean;
	checkedAt?: number;
	errorKind?:
		| "network"
		| "feed"
		| "disk-space"
		| "signature"
		| "environment"
		| "release"
		| "unknown";
}

export interface AutoUpdateVersionInfo {
	currentVersion: string;
	repositoryUrl: string;
	releasesUrl: string;
	feedUrl: string;
	channel: "stable" | "canary";
	packaged: boolean;
	platform: string;
}

export const RELEASES_URL = JEDV_RELEASES_URL;

import { JEDV_RELEASES_URL } from "./jedv";
