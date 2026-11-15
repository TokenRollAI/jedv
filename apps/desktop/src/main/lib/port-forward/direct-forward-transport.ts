import type { Duplex } from "node:stream";
import type { SecureContextOptions } from "node:tls";
import type { ForwardTarget } from "shared/types";
import { forwardAbortError, MuxSession } from "./mux-session";
import type { ForwardRequestOptions, ForwardTransport } from "./types";

export interface DirectForwardEndpoint {
	baseUrl: string;
	/** A host-service credential, supplied by trusted main-process configuration. */
	token: string;
	ca?: SecureContextOptions["ca"];
}

export interface DirectForwardTransportOptions {
	resolveEndpoint: (target: ForwardTarget) => DirectForwardEndpoint | null;
	helloTimeoutMs?: number;
	openTimeoutMs?: number;
}

interface DirectSession {
	session: MuxSession;
	token: string;
	ca: SecureContextOptions["ca"];
	pending: number;
}

export class DirectForwardTransport implements ForwardTransport {
	readonly kind = "direct" as const;
	private readonly sessions = new Map<string, DirectSession>();

	constructor(private readonly options: DirectForwardTransportOptions) {}

	async probe(
		target: ForwardTarget,
		options: ForwardRequestOptions = {},
	): Promise<void> {
		await this.withSession(target, options, async () => {});
	}

	openStream(
		target: ForwardTarget,
		options: ForwardRequestOptions = {},
	): Promise<Duplex> {
		return this.withSession(target, options, (session) =>
			session.openStream(target.remotePort, options),
		);
	}

	closeAll(): void {
		const entries = [...this.sessions.values()];
		this.sessions.clear();
		for (const { session } of entries) session.close();
	}

	closeHost(baseUrl: string): void {
		const endpoint = new URL(baseUrl);
		endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
		const origin = endpoint.origin;
		for (const [key, entry] of this.sessions) {
			const [address] = JSON.parse(key) as [string, string];
			if (new URL(address).origin !== origin) continue;
			this.sessions.delete(key);
			entry.session.close();
		}
	}

	private async withSession<T>(
		target: ForwardTarget,
		{ signal }: ForwardRequestOptions,
		run: (session: MuxSession) => Promise<T>,
	): Promise<T> {
		if (signal?.aborted) throw forwardAbortError();
		const entry = this.session(target);
		entry.pending++;
		try {
			await waitForReady(entry.session.ready, signal);
			if (signal?.aborted) throw forwardAbortError();
			return await run(entry.session);
		} finally {
			entry.pending--;
			if (signal?.aborted && !entry.pending && !entry.session.streamCount()) {
				entry.session.close();
			}
		}
	}

	private session(target: ForwardTarget): DirectSession {
		if (!target.workspaceId.trim()) throw new Error("Workspace ID is required");
		if (
			!Number.isInteger(target.remotePort) ||
			target.remotePort < 1 ||
			target.remotePort > 65535
		) {
			throw new Error("Invalid remote port");
		}
		const endpoint = this.options.resolveEndpoint(target);
		if (!endpoint) throw new Error("Direct host endpoint is not configured");
		const url = directForwardUrl(endpoint, target.workspaceId);
		const key = JSON.stringify([url.toString(), target.workspaceId]);
		const existing = this.sessions.get(key);
		if (existing && !existing.session.isDead) {
			if (existing.token === endpoint.token && existing.ca === endpoint.ca) {
				return existing;
			}
			existing.session.close();
		}
		const session = new MuxSession(url.toString(), {
			headers: { Authorization: `Bearer ${endpoint.token}` },
			ca: endpoint.ca,
			helloTimeoutMs: this.options.helloTimeoutMs,
			openTimeoutMs: this.options.openTimeoutMs,
			describeUpgradeFailure: describeDirectUpgradeFailure,
			onClosed: () => {
				if (this.sessions.get(key)?.session === session) {
					this.sessions.delete(key);
				}
			},
		});
		const entry = {
			session,
			token: endpoint.token,
			ca: endpoint.ca,
			pending: 0,
		};
		this.sessions.set(key, entry);
		return entry;
	}
}

function directForwardUrl(
	endpoint: DirectForwardEndpoint,
	workspaceId: string,
): URL {
	let url: URL;
	try {
		url = new URL(endpoint.baseUrl);
	} catch {
		throw new Error("Invalid direct host base URL");
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/" ||
		["0.0.0.0", "[::]"].includes(url.hostname)
	) {
		throw new Error("Direct host base URL must be an HTTP(S) origin");
	}
	const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
	if (url.protocol === "http:" && !loopback) {
		throw new Error("Direct host requires HTTPS outside loopback");
	}
	if (!/^[\x21-\x7e]+$/.test(endpoint.token)) {
		throw new Error(
			"Direct host credential is required and must contain no whitespace",
		);
	}
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = "/fwd";
	url.searchParams.set("workspaceId", workspaceId);
	return url;
}

function waitForReady(
	ready: Promise<void>,
	signal?: AbortSignal,
): Promise<void> {
	if (!signal) return ready;
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(forwardAbortError());
		};
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		ready.then(
			() => {
				signal.removeEventListener("abort", abort);
				resolve();
			},
			(error) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}

function describeDirectUpgradeFailure(status: number | undefined): string {
	if (status === 401) return "Direct host rejected the credential";
	if (status === 403) return "No access to this direct host";
	if (status === 404 || status === 405) {
		return "Direct host does not support port forwarding (update the host-service)";
	}
	return `Direct host refused the stream (${status ?? "unknown"})`;
}
