import {
	mailDeliverySchema,
	mailInboxSchema,
	mailSendSchema,
	mailWatchSchema,
	teamSelectorSchema,
} from "@jedv/shared/teamwork";
import { z } from "zod";
import { requireTeamwork } from "../../../teams/runtime";
import { protectedProcedure, router } from "../../index";

export const mailRouter = router({
	send: protectedProcedure
		.input(mailSendSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).mail.send(input),
		),
	inbox: protectedProcedure
		.input(mailInboxSchema)
		.query(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).mail.inbox(input),
		),
	read: protectedProcedure
		.input(mailDeliverySchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).mail.consume(input, false),
		),
	ack: protectedProcedure
		.input(mailDeliverySchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).mail.consume(input, true),
		),
	watch: protectedProcedure
		.input(mailWatchSchema)
		.query(async ({ ctx, input, signal }) =>
			(await requireTeamwork(ctx)).mail.watch(input, signal),
		),
	timeline: protectedProcedure
		.input(
			teamSelectorSchema.extend({
				limit: z.number().int().min(1).max(500).default(100),
			}),
		)
		.query(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).mail.timeline(input),
		),
});
