import {
	memoryListSchema,
	memoryProjectFileSchema,
	memoryPutSchema,
	memoryReviewSchema,
	memoryScopeSchema,
	memorySearchSchema,
	memoryTransferSchema,
} from "@jedv/shared/memory";
import { z } from "zod";
import { requireMemory } from "../../../memory/runtime";
import { protectedProcedure, router } from "../../index";
export const memoryRouter = router({
	capabilities: protectedProcedure.query(() => ({ protocolVersion: 1 })),
	list: protectedProcedure
		.input(memoryListSchema)
		.query(({ ctx, input }) => requireMemory(ctx).memory.list(input)),
	search: protectedProcedure
		.input(memorySearchSchema)
		.query(({ ctx, input }) => requireMemory(ctx).memory.search(input)),
	put: protectedProcedure
		.input(memoryPutSchema)
		.mutation(({ ctx, input }) => requireMemory(ctx).memory.put(input)),
	reviewCandidate: protectedProcedure
		.input(memoryReviewSchema)
		.mutation(({ ctx, input }) =>
			requireMemory(ctx).memory.reviewCandidate(input),
		),
	remove: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(({ ctx, input }) => requireMemory(ctx).memory.remove(input.id)),
	exportData: protectedProcedure
		.input(memoryScopeSchema)
		.query(({ ctx, input }) => requireMemory(ctx).memory.exportData(input)),
	importData: protectedProcedure
		.input(z.object({ scope: memoryScopeSchema, data: memoryTransferSchema }))
		.mutation(({ ctx, input }) =>
			requireMemory(ctx).memory.importData(input.scope, input.data),
		),
	exportProject: protectedProcedure
		.input(memoryProjectFileSchema)
		.mutation(({ ctx, input }) =>
			requireMemory(ctx).memory.exportProject(input),
		),
	importProject: protectedProcedure
		.input(memoryProjectFileSchema.extend({ filePath: z.string().min(1) }))
		.mutation(({ ctx, input }) =>
			requireMemory(ctx).memory.importProject(input),
		),
});
export type MemoryRouter = typeof memoryRouter;
