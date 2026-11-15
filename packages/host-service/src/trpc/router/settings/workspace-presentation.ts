import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { workspacePresentation, workspaces } from "../../../db/schema";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";

function assertActive(ctx: HostServiceContext, workspaceId: string) {
	const row = ctx.db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(and(eq(workspaces.id, workspaceId), isNull(workspaces.archivedAt)))
		.get();
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Workspace not found" });
	}
}

export const workspacePresentationRouter = router({
	list: protectedProcedure.query(({ ctx }) =>
		ctx.db
			.select({
				workspaceId: workspacePresentation.workspaceId,
				pinned: workspacePresentation.pinned,
				position: workspacePresentation.position,
			})
			.from(workspacePresentation)
			.innerJoin(
				workspaces,
				eq(workspaces.id, workspacePresentation.workspaceId),
			)
			.where(
				and(
					eq(workspacePresentation.userId, ctx.userId ?? ""),
					isNull(workspaces.archivedAt),
				),
			)
			.all(),
	),
	setPinned: protectedProcedure
		.input(z.object({ workspaceId: z.string().min(1), pinned: z.boolean() }))
		.mutation(({ ctx, input }) => {
			assertActive(ctx, input.workspaceId);
			ctx.db
				.insert(workspacePresentation)
				.values({ ...input, userId: ctx.userId ?? "" })
				.onConflictDoUpdate({
					target: [
						workspacePresentation.workspaceId,
						workspacePresentation.userId,
					],
					set: { pinned: input.pinned },
				})
				.run();
			return { success: true as const };
		}),
	reorder: protectedProcedure
		.input(
			z.object({
				projectId: z.string().nullable(),
				workspaceIds: z.array(z.string().min(1)).max(1000),
			}),
		)
		.mutation(({ ctx, input }) => {
			const ids = new Set(input.workspaceIds);
			if (ids.size !== input.workspaceIds.length) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Duplicate workspace",
				});
			}
			ctx.db.transaction((tx) => {
				const rows = tx
					.select({ id: workspaces.id })
					.from(workspaces)
					.where(
						and(
							isNull(workspaces.archivedAt),
							input.projectId === null
								? isNull(workspaces.projectId)
								: eq(workspaces.projectId, input.projectId),
						),
					)
					.all();
				if (rows.length !== ids.size || rows.some((row) => !ids.has(row.id))) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Workspace list changed; refresh before reordering",
					});
				}
				for (const [position, workspaceId] of input.workspaceIds.entries()) {
					tx.insert(workspacePresentation)
						.values({ workspaceId, userId: ctx.userId ?? "", position })
						.onConflictDoUpdate({
							target: [
								workspacePresentation.workspaceId,
								workspacePresentation.userId,
							],
							set: { position },
						})
						.run();
				}
			});
			return { success: true as const };
		}),
});
