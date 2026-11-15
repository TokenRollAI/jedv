import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";

function service(ctx: HostServiceContext) {
	if (!ctx.runtime.slots)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Declarative slots are unavailable",
		});
	return ctx.runtime.slots;
}
const extensionId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const declarativeSlotsRouter = router({
	capabilities: protectedProcedure.query(() => ({
		protocolVersion: 1 as const,
	})),
	list: protectedProcedure.query(({ ctx }) => service(ctx).list()),
	install: protectedProcedure
		.input(
			z
				.object({
					manifestPath: z.string().min(1),
					bindTeamId: z.string().min(1).optional(),
				})
				.strict(),
		)
		.mutation(({ ctx, input }) => service(ctx).install(input)),
	setEnabled: protectedProcedure
		.input(z.object({ extensionId, enabled: z.boolean() }).strict())
		.mutation(({ ctx, input }) => service(ctx).setEnabled(input)),
	uninstall: protectedProcedure
		.input(z.object({ extensionId }).strict())
		.mutation(({ ctx, input }) => service(ctx).uninstall(input)),
	resolveView: protectedProcedure
		.input(
			z
				.object({
					surface: z.enum(["teamwork.header", "sidebar.panel"]),
					teamId: z.string().optional(),
				})
				.strict(),
		)
		.query(({ ctx, input }) => service(ctx).resolveView(input)),
});
