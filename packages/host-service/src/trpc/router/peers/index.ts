import {
	outboxListSchema,
	peerUpsertSchema,
	providerTokenSchema,
} from "@jedv/shared/teamwork-peers";
import { z } from "zod";
import { requireTeamwork } from "../../../teams/runtime";
import { protectedProcedure, router } from "../../index";

const peer = z.object({ peerId: z.string().min(1).max(128) });
export const peersRouter = router({
	capabilities: protectedProcedure.query(() => ({
		protocolVersion: 1 as const,
	})),
	list: protectedProcedure.query(async ({ ctx }) =>
		(await requireTeamwork(ctx)).peers.list(),
	),
	upsert: protectedProcedure
		.input(peerUpsertSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).peers.upsert(input),
		),
	remove: protectedProcedure
		.input(peer)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).peers.remove(input.peerId),
		),
	rotateInbound: protectedProcedure
		.input(peer)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).peers.rotateInbound(input.peerId),
		),
	outbox: protectedProcedure
		.input(outboxListSchema)
		.query(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).peers.outbox(input),
		),
	retryDeadOutbox: protectedProcedure
		.input(z.object({ outboxId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).peers.retryDeadOutbox(input.outboxId),
		),
	listProviderTokens: protectedProcedure.query(async ({ ctx }) =>
		(await requireTeamwork(ctx)).peers.listProviderTokens(),
	),
	createProviderToken: protectedProcedure
		.input(providerTokenSchema)
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).peers.createProviderToken(input),
		),
	revokeProviderToken: protectedProcedure
		.input(z.object({ tokenId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) =>
			(await requireTeamwork(ctx)).peers.revokeProviderToken(input.tokenId),
		),
});
