import { EventEmitter } from "node:events";
import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { appState } from "main/lib/app-state";
import {
	connectedOrigin,
	localHostOrigin,
	requireMainWindow,
} from "main/lib/main-events";
import { mainWindowKey } from "main/lib/main-events/window-access";
import {
	jsonBytes,
	WORKSPACE_LAYOUT_BYTES,
	WORKSPACE_LAYOUT_CONTEXTS,
	workspaceLayoutSchema,
} from "shared/jedv-workspace-layout";
import {
	MAX_WORKSPACE_READ_RECEIPTS,
	type WorkspaceReadReceiptChange,
} from "shared/workspace-read-receipts";
import { z } from "zod";
import { publicProcedure, router } from "../..";

const contextSchema = z.object({
	hostUrl: z.string().min(1).max(2048),
	workspaceId: z.string().min(1).max(256),
});
const changes = new EventEmitter();
changes.setMaxListeners(20);
let writes: Promise<unknown> = Promise.resolve();
function serialized<T>(action: () => Promise<T>): Promise<T> {
	const next = writes.then(action, action);
	writes = next.catch(() => {});
	return next;
}
function hostIdentity(hostUrl: string): string {
	const origin = connectedOrigin(hostUrl);
	return origin === localHostOrigin() ? "local" : origin;
}
export function createWorkspaceLayoutsRouter(write: () => Promise<void>) {
	return router({
		get: publicProcedure.input(contextSchema).query(({ ctx, input }) => {
			const key = mainWindowKey(ctx.senderWindow);
			const hostId = hostIdentity(input.hostUrl);
			return (
				appState.data.workspaceLayoutsByWindow?.[key]?.find(
					(entry) =>
						entry.hostId === hostId && entry.workspaceId === input.workspaceId,
				)?.layout ?? null
			);
		}),
		set: publicProcedure
			.input(contextSchema.extend({ layout: workspaceLayoutSchema }))
			.mutation(({ ctx, input }) => {
				const key = mainWindowKey(ctx.senderWindow);
				const hostId = hostIdentity(input.hostUrl);
				return serialized(async () => {
					mainWindowKey(ctx.senderWindow);
					if (hostIdentity(input.hostUrl) !== hostId)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Host connection changed",
						});
					const previous = appState.data.workspaceLayoutsByWindow;
					const records = previous ?? {};
					if (!(key in records) && Object.keys(records).length >= 20)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Window limit reached",
						});
					const contexts = (records[key] ?? []).filter(
						(entry) =>
							entry.hostId !== hostId ||
							entry.workspaceId !== input.workspaceId,
					);
					if (contexts.length >= WORKSPACE_LAYOUT_CONTEXTS)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Workspace layout limit reached (8 contexts per window)",
						});
					const next = {
						...records,
						[key]: [
							...contexts,
							{ hostId, workspaceId: input.workspaceId, layout: input.layout },
						],
					};
					if (jsonBytes(next) > WORKSPACE_LAYOUT_BYTES)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Saved workspace layouts exceed 512 KiB",
						});
					appState.data.workspaceLayoutsByWindow = next;
					try {
						await write();
					} catch (error) {
						appState.data.workspaceLayoutsByWindow = previous;
						throw error;
					}
					return { success: true as const };
				});
			}),
	});
}
export function createReadReceiptsRouter(write: () => Promise<void>) {
	return router({
		get: publicProcedure.query(({ ctx }) => {
			requireMainWindow(ctx.senderWindow);
			return appState.data.workspaceReadReceipts ?? [];
		}),
		set: publicProcedure
			.input(
				contextSchema.extend({
					readThrough: z
						.number()
						.finite()
						.refine((value) => value === -1 || value > 0)
						.nullable(),
				}),
			)
			.mutation(({ ctx, input }) => {
				requireMainWindow(ctx.senderWindow);
				const hostId = hostIdentity(input.hostUrl);
				return serialized(async () => {
					requireMainWindow(ctx.senderWindow);
					if (hostIdentity(input.hostUrl) !== hostId)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Host connection changed",
						});
					const previous = appState.data.workspaceReadReceipts;
					const current = previous ?? [];
					const existing = current.find(
						(entry) =>
							entry.hostId === hostId &&
							entry.workspaceId === input.workspaceId,
					);
					const readThrough =
						input.readThrough !== null &&
						input.readThrough > 0 &&
						existing &&
						existing.readThrough > 0
							? Math.max(existing.readThrough, input.readThrough)
							: input.readThrough;
					const records = current.filter(
						(entry) =>
							entry.hostId !== hostId ||
							entry.workspaceId !== input.workspaceId,
					);
					if (readThrough !== null)
						records.push({
							hostId,
							workspaceId: input.workspaceId,
							readThrough,
						});
					const evicted =
						records.length > MAX_WORKSPACE_READ_RECEIPTS
							? records.shift()
							: undefined;
					appState.data.workspaceReadReceipts = records;
					try {
						await write();
					} catch (error) {
						appState.data.workspaceReadReceipts = previous;
						throw error;
					}
					const change: WorkspaceReadReceiptChange = {
						hostId,
						workspaceId: input.workspaceId,
						readThrough,
						...(evicted
							? {
									evicted: {
										hostId: evicted.hostId,
										workspaceId: evicted.workspaceId,
									},
								}
							: {}),
					};
					changes.emit("change", change);
					return change;
				});
			}),
		change: publicProcedure.subscription(({ ctx }) => {
			const window = requireMainWindow(ctx.senderWindow);
			return observable<WorkspaceReadReceiptChange>((emit) => {
				const listener = (change: WorkspaceReadReceiptChange) =>
					emit.next(change);
				const closed = () => {
					changes.off("change", listener);
					emit.complete();
				};
				changes.on("change", listener);
				window.once("closed", closed);
				return () => {
					changes.off("change", listener);
					window.removeListener("closed", closed);
				};
			});
		}),
	});
}
