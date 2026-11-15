import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { HostServiceContext } from "../../../types";
import type { CreateResult } from "./handlers";

export type CreateOperationState =
	| { status: "unknown" | "running" | "cancelled" | "failed" }
	| { status: "completed"; result: CreateResult };

type Operation = {
	inputHash: string;
	state: CreateOperationState;
	promise: Promise<CreateResult>;
	settledAt?: number;
};

const stores = new WeakMap<object, Map<string, Operation>>();
const capacity = 128;
const retentionMs = 10 * 60 * 1000;

function operations(ctx: Pick<HostServiceContext, "db">) {
	let store = stores.get(ctx.db);
	if (!store) {
		store = new Map();
		stores.set(ctx.db, store);
	}
	for (const [key, operation] of store) {
		if (
			operation.settledAt !== undefined &&
			Date.now() - operation.settledAt > retentionMs
		) {
			store.delete(key);
		}
	}
	return store;
}

function operationKey(ctx: Pick<HostServiceContext, "userId">, id: string) {
	return JSON.stringify([ctx.userId ?? "", id]);
}

export function getCreateOperation(
	ctx: Pick<HostServiceContext, "db" | "userId">,
	operationId: string,
): CreateOperationState {
	return (
		operations(ctx).get(operationKey(ctx, operationId))?.state ?? {
			status: "unknown",
		}
	);
}

export function runCreateOperation(
	ctx: Pick<HostServiceContext, "db" | "userId">,
	input: { operationId?: string; name: string; mode: unknown },
	signal: AbortSignal | undefined,
	work: () => Promise<CreateResult>,
): Promise<CreateResult> {
	if (!input.operationId) return work();
	const store = operations(ctx);
	const key = operationKey(ctx, input.operationId);
	const inputHash = createHash("sha256")
		.update(JSON.stringify([input.name, input.mode]))
		.digest("hex");
	const existing = store.get(key);
	if (existing) {
		if (existing.inputHash !== inputHash) {
			throw new TRPCError({
				code: "CONFLICT",
				message: "Project operation belongs to another request",
			});
		}
		return existing.promise;
	}
	if (store.size >= capacity) {
		const oldest = [...store].find(([, item]) => item.settledAt !== undefined);
		if (oldest) store.delete(oldest[0]);
		else
			throw new TRPCError({
				code: "TOO_MANY_REQUESTS",
				message: "Too many project operations in progress",
			});
	}
	const operation: Operation = {
		inputHash,
		state: { status: "running" },
		promise: Promise.resolve().then(async () => {
			try {
				signal?.throwIfAborted();
				const result = await work();
				operation.state = { status: "completed", result };
				return result;
			} catch (error) {
				operation.state = { status: signal?.aborted ? "cancelled" : "failed" };
				throw error;
			} finally {
				operation.settledAt = Date.now();
			}
		}),
	};
	store.set(key, operation);
	return operation.promise;
}
