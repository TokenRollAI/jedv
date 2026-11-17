/** Antigravity CLI quota from the same read-only Google login used by `agy`. */
import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";
import type { UsageAccount, UsageQuotaWindow } from "./types";

const execFileAsync = promisify(execFile);
const BASE_URLS = [
	"https://daily-cloudcode-pa.googleapis.com",
	"https://cloudcode-pa.googleapis.com",
];
const FETCH_TIMEOUT_MS = 10_000;

const BUCKETS: Record<string, string> = {
	"gemini-5h": "Session — Gemini Models",
	"gemini-weekly": "Weekly — Gemini Models",
	"3p-5h": "Session — Claude and GPT Models",
	"3p-weekly": "Weekly — Claude and GPT Models",
};

const CANONICAL_GEMINI_IDS = ["gemini-5h", "gemini-weekly"] as const;
const CANONICAL_THIRD_PARTY_IDS = ["3p-5h", "3p-weekly"] as const;

function formatBucketName(raw: string): string {
	return raw
		.split(/[-_]+/)
		.filter(Boolean)
		.map((part) => {
			const lower = part.toLowerCase();
			if (lower === "3p") return "Claude and GPT";
			if (lower === "gpt") return "GPT";
			if (lower === "ai") return "AI";
			return lower.charAt(0).toUpperCase() + lower.slice(1);
		})
		.join(" ");
}

function readLabelCandidate(
	record: Record<string, unknown>,
): string | undefined {
	for (const key of ["label", "displayName", "title", "name"] as const) {
		const candidate = record[key];
		if (typeof candidate === "string" && candidate.trim()) {
			return candidate.trim();
		}
	}
	return undefined;
}

function bucketLabel(
	bucketId: string,
	item: Record<string, unknown>,
	groupLabel?: string,
): string {
	const known = BUCKETS[bucketId];
	if (known) return known;
	const itemLabel = readLabelCandidate(item);
	if (itemLabel) return itemLabel;
	const sessionMatch = /^(.+?)[-_]5h$/i.exec(bucketId);
	if (sessionMatch?.[1]) {
		return `Session — ${formatBucketName(sessionMatch[1])}`;
	}
	const weeklyMatch = /^(.+?)[-_]weekly$/i.exec(bucketId);
	if (weeklyMatch?.[1]) {
		return `Weekly — ${formatBucketName(weeklyMatch[1])}`;
	}
	return groupLabel || formatBucketName(bucketId);
}

interface AgyAuth {
	token?: {
		access_token?: string;
		expiry?: string | number;
	};
	email?: string;
}

function expiryMs(value: string | number | undefined): number {
	if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
	if (typeof value === "string") {
		const numeric = Number(value);
		if (Number.isFinite(numeric))
			return numeric < 1e12 ? numeric * 1000 : numeric;
		return Date.parse(value);
	}
	return Number.POSITIVE_INFINITY;
}

async function readAgyAuth(): Promise<AgyAuth | null> {
	if (platform() !== "darwin") return null;
	try {
		const { stdout } = await execFileAsync(
			"security",
			["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"],
			{ timeout: 5_000 },
		);
		const raw = stdout.trim().replace(/^go-keyring-base64:/, "");
		const text = stdout.trim().startsWith("go-keyring-base64:")
			? Buffer.from(raw, "base64").toString("utf8")
			: raw;
		return JSON.parse(text) as AgyAuth;
	} catch {
		return null;
	}
}

export function mapAgyQuotaWindows(value: unknown): UsageQuotaWindow[] {
	const groups =
		typeof value === "object" && value !== null && "groups" in value
			? (value as { groups?: unknown }).groups
			: null;
	if (!Array.isArray(groups)) return [];
	const found = new Map<
		string,
		{ window: UsageQuotaWindow; isGemini: boolean }
	>();
	for (const group of groups) {
		if (!group || typeof group !== "object" || !("buckets" in group)) continue;
		const groupRecord = group as Record<string, unknown>;
		const groupLabel = readLabelCandidate(groupRecord);
		const groupId =
			typeof groupRecord.groupId === "string" ? groupRecord.groupId : "";
		const buckets = groupRecord.buckets;
		if (!Array.isArray(buckets)) continue;
		for (const bucket of buckets) {
			if (!bucket || typeof bucket !== "object") continue;
			const item = bucket as Record<string, unknown> & {
				bucketId?: unknown;
				remainingFraction?: unknown;
				resetTime?: unknown;
			};
			if (
				typeof item.bucketId !== "string" ||
				!item.bucketId.trim() ||
				typeof item.remainingFraction !== "number" ||
				!Number.isFinite(item.remainingFraction)
			)
				continue;
			const bucketId = item.bucketId.trim();
			const reset =
				typeof item.resetTime === "string" ? new Date(item.resetTime) : null;
			const isGemini =
				bucketId.toLowerCase().includes("gemini") ||
				groupId.toLowerCase().includes("gemini") ||
				(groupLabel?.toLowerCase().includes("gemini") ?? false);
			found.set(bucketId, {
				isGemini,
				window: {
					id: bucketId,
					label: bucketLabel(bucketId, item, groupLabel),
					usedPercent: Math.round(
						(1 - Math.max(0, Math.min(1, item.remainingFraction))) * 100,
					),
					resetsAt: reset && !Number.isNaN(reset.getTime()) ? reset : null,
				},
			});
		}
	}
	const ordered: UsageQuotaWindow[] = [];
	const emitted = new Set<string>();
	const emitId = (id: string) => {
		const entry = found.get(id);
		if (!entry || emitted.has(id)) return;
		emitted.add(id);
		ordered.push(entry.window);
	};
	for (const id of CANONICAL_GEMINI_IDS) emitId(id);
	for (const [id, entry] of found) {
		if (entry.isGemini) emitId(id);
	}
	for (const id of CANONICAL_THIRD_PARTY_IDS) emitId(id);
	for (const id of found.keys()) emitId(id);
	return ordered;
}

export async function fetchAgyAccounts(): Promise<UsageAccount[]> {
	const auth = await readAgyAuth();
	const accessToken = auth?.token?.access_token;
	if (!accessToken) return [];
	const base = {
		agent: "agy" as const,
		credentialKind: "subscription" as const,
		accountKey: "keychain:gemini:antigravity",
		sourceLabel: "Keychain",
		email: auth?.email ?? null,
		plan: null,
		creditsBalance: null,
		extraUsage: null,
		selection: null,
		isDefault: false,
		fetchedAt: new Date(),
	};
	const expiry = expiryMs(auth?.token?.expiry);
	if (Number.isFinite(expiry) && expiry <= Date.now()) {
		return [
			{
				...base,
				status: "token_expired",
				statusDetail: "Antigravity sign-in expired — run `agy` to refresh it.",
				windows: [],
			},
		];
	}
	try {
		let lastStatus = 0;
		for (const baseUrl of BASE_URLS) {
			const response = await fetch(
				`${baseUrl}/v1internal:retrieveUserQuotaSummary`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${accessToken}`,
						"Content-Type": "application/json",
						"User-Agent": "antigravity",
					},
					body: "{}",
					signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				},
			);
			lastStatus = response.status;
			if (response.status === 401 || response.status === 403) {
				return [
					{
						...base,
						status: "token_expired",
						statusDetail:
							"Antigravity sign-in expired — run `agy` to refresh it.",
						windows: [],
					},
				];
			}
			if (!response.ok) continue;
			const windows = mapAgyQuotaWindows(await response.json());
			if (windows.length > 0)
				return [{ ...base, status: "ok", statusDetail: null, windows }];
		}
		throw new Error(`Usage endpoint returned ${lastStatus || "no data"}.`);
	} catch (error) {
		return [
			{
				...base,
				status: "unavailable",
				statusDetail:
					error instanceof Error ? error.message : "Failed to fetch usage.",
				windows: [],
			},
		];
	}
}
