import {
	TEAMWORK_PROTOCOL_VERSION,
	type TeamworkCapabilities,
	teamArchiveSchema,
	teamInitSchema,
	teamRenameSchema,
	teamSelectorSchema,
	teamSpawnSchema,
	teamStartSchema,
	teamStopSchema,
} from "@jedv/shared/teamwork";
import { z } from "zod";
import { requireTeamwork } from "../../../teams/runtime";
import { protectedProcedure, router } from "../../index";

export const teamRouter = router({
	capabilities: protectedProcedure.query(
		(): TeamworkCapabilities => ({
			protocolVersion: TEAMWORK_PROTOCOL_VERSION,
			localOnly: true as const,
			features: { start: true },
			orderedHooks: true as const,
		}),
	),
	start: protectedProcedure
		.input(teamStartSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).team.start(input),
		),
	init: protectedProcedure
		.input(teamInitSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).team.init(input),
		),
	spawn: protectedProcedure
		.input(teamSpawnSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).team.spawn(input),
		),
	status: protectedProcedure
		.input(teamSelectorSchema)
		.query(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).team.status(input),
		),
	list: protectedProcedure
		.input(
			z
				.object({ status: z.enum(["active", "all"]).default("active") })
				.default({ status: "active" }),
		)
		.query(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).team.list(input.status),
		),
	rename: protectedProcedure
		.input(teamRenameSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).team.rename(input),
		),
	pause: protectedProcedure
		.input(teamSelectorSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).team.setPaused(input, true),
		),
	resume: protectedProcedure
		.input(teamSelectorSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).team.setPaused(input, false),
		),
	stop: protectedProcedure
		.input(teamStopSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).team.stop(input),
		),
	archive: protectedProcedure
		.input(teamArchiveSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).team.archive(input),
		),
	reconcile: protectedProcedure
		.input(teamSelectorSchema)
		.mutation(async ({ ctx, input }) => {
			const runtime = await requireTeamwork(ctx);
			runtime.team.resolve(input);
			await runtime.team.recover();
			return runtime.team.status(input);
		}),
});
