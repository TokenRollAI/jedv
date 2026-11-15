import { z } from "zod";
import { requireMemory } from "../../../memory/runtime";
import { protectedProcedure, router } from "../../index";
export const watchdogRouter = router({
	listAlerts: protectedProcedure
		.input(
			z
				.object({
					status: z.enum(["unread", "all"]).default("unread"),
					limit: z.number().int().min(1).max(500).default(100),
				})
				.default({ status: "unread", limit: 100 }),
		)
		.query(({ ctx, input }) => requireMemory(ctx).watchdog.listAlerts(input)),
	markRead: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(({ ctx, input }) =>
			requireMemory(ctx).watchdog.markRead(input.id),
		),
});
