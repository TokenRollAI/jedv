import { TRPCError } from "@trpc/server";
import { DeepseekClient } from "../ai/deepseek";
import { DeepseekSecretStore } from "../ai/secrets";
import type { HostServiceContext } from "../types";
import { RuleWatchdog } from "../watchdog/service";
import {
	PassiveMemoryExtractor,
	type TranscriptExtraction,
} from "./extraction";
import { type MemoryDependencies, MemoryService } from "./service";
import type { MemorySqlite } from "./sqlite";

export class MemoryRuntime {
	readonly memory: MemoryService;
	readonly secrets: DeepseekSecretStore;
	readonly ai: DeepseekClient;
	readonly extractor: PassiveMemoryExtractor;
	readonly watchdog: RuleWatchdog;
	constructor(options: {
		db: MemorySqlite;
		memory: MemoryDependencies;
		home?: () => string;
		transcriptHome?: () => string;
		deepseek?: Omit<ConstructorParameters<typeof DeepseekClient>[0], "readKey">;
		watchdog: Omit<ConstructorParameters<typeof RuleWatchdog>[0], "db">;
	}) {
		this.memory = new MemoryService(options.db, options.memory);
		this.secrets = new DeepseekSecretStore(options.home);
		this.ai = new DeepseekClient({
			...options.deepseek,
			readKey: () => this.secrets.readKey(),
		});
		this.extractor = new PassiveMemoryExtractor(
			this.memory,
			this.ai,
			options.transcriptHome,
		);
		this.watchdog = new RuleWatchdog({ ...options.watchdog, db: options.db });
	}
	private disposed = false;
	private readonly jobs = new Map<string, Promise<unknown>>();
	private readonly seen = new Set<string>();
	private readonly trustedTranscripts = new Map<string, string>();
	rememberTranscript(identity: string, path: string) {
		this.trustedTranscripts.set(identity, path);
		if (this.trustedTranscripts.size > 1024)
			this.trustedTranscripts.delete(
				this.trustedTranscripts.keys().next().value ?? "",
			);
	}
	transcriptFor(identity: string) {
		return this.trustedTranscripts.get(identity);
	}
	enqueueExtraction(input: TranscriptExtraction, eventId: string) {
		if (this.disposed || this.seen.has(eventId) || this.jobs.size >= 4)
			return Promise.resolve();
		this.seen.add(eventId);
		if (this.seen.size > 1024)
			this.seen.delete(this.seen.values().next().value ?? "");
		const job = this.extractor
			.extract(input)
			.finally(() => this.jobs.delete(eventId));
		this.jobs.set(eventId, job);
		return job.then(() => {});
	}
	start() {
		this.watchdog.start();
	}
	async flushExtractions() {
		await Promise.allSettled([...this.jobs.values()]);
	}
	async dispose() {
		this.disposed = true;
		this.ai.dispose();
		await this.watchdog.dispose();
		await Promise.allSettled([...this.jobs.values()]);
		this.seen.clear();
		this.trustedTranscripts.clear();
	}
}
// Standalone router fixtures can register a runtime without constructing the full Host.
const runtimes = new WeakMap<object, MemoryRuntime>();
export function registerMemoryRuntime(owner: object, runtime: MemoryRuntime) {
	runtimes.set(owner, runtime);
	return () => runtimes.delete(owner);
}
export function requireMemory(ctx: HostServiceContext) {
	const runtime = ctx.runtime?.memory ?? runtimes.get(ctx.runtime ?? ctx);
	if (!runtime)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Memory is unavailable on this host",
		});
	return runtime;
}
