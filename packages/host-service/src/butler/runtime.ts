import { TRPCError } from "@trpc/server";
import type { HostServiceContext } from "../types";
import { ButlerService } from "./service";
import { ButlerTools } from "./tools";
export function createButler(ctx: HostServiceContext) {
	const memory = ctx.runtime.memory;
	if (!memory)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Memory runtime is unavailable",
		});
	return new ButlerService({
		db: ctx.db.$client,
		ai: memory.ai,
		tools: new ButlerTools(ctx),
		alerts: () => memory.watchdog.listAlerts({ limit: 20 }),
		watchdog: memory.watchdog,
	});
}
export function requireButler(ctx: HostServiceContext) {
	const butler = ctx.runtime.butler;
	if (!butler)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Butler is unavailable on this host",
		});
	return butler;
}
