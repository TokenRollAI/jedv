import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requireMemory } from "../../../memory/runtime";
import { protectedProcedure, router } from "../../index";
export const aiSettingsRouter = router({
	get: protectedProcedure.query(({ ctx }) => requireMemory(ctx).secrets.get()),
	setDeepseekKey: protectedProcedure
		.input(z.object({ apiKey: z.string().max(512).nullable() }))
		.mutation(({ ctx, input }) => {
			try {
				return requireMemory(ctx).secrets.setDeepseekKey(input.apiKey);
			} catch {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Unable to update DeepSeek key",
				});
			}
		}),
});
