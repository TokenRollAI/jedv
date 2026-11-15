import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	automationInputSchema,
	automationPatchSchema,
} from "../../../automations/schema";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";

function service(ctx: HostServiceContext) {
	const automations = ctx.runtime.automations;
	if (!automations)
		throw new TRPCError({
			code: "SERVICE_UNAVAILABLE",
			message:
				ctx.runtime.automationsError ??
				"Local automation scheduler is unavailable",
		});
	return automations;
}
const identified = z.object({ id: z.string().uuid() });
export const automationsRouter = router({
	list: protectedProcedure.query(({ ctx }) => service(ctx).list()),
	get: protectedProcedure
		.input(identified)
		.query(({ ctx, input }) => service(ctx).get(input.id)),
	create: protectedProcedure
		.input(automationInputSchema)
		.mutation(({ ctx, input }) => service(ctx).create(input)),
	update: protectedProcedure
		.input(identified.extend({ patch: automationPatchSchema }))
		.mutation(({ ctx, input }) => service(ctx).update(input.id, input.patch)),
	setEnabled: protectedProcedure
		.input(identified.extend({ enabled: z.boolean() }))
		.mutation(({ ctx, input }) =>
			service(ctx).update(input.id, { enabled: input.enabled }),
		),
	remove: protectedProcedure
		.input(identified)
		.mutation(({ ctx, input }) => service(ctx).remove(input.id)),
	runNow: protectedProcedure
		.input(identified)
		.mutation(({ ctx, input }) => service(ctx).runNow(input.id)),
	listRuns: protectedProcedure
		.input(z.object({ automationId: z.string().uuid() }))
		.query(({ ctx, input }) => service(ctx).listRuns(input.automationId)),
});
