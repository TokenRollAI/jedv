import {
	butlerApprovalListSchema,
	butlerHistorySchema,
	butlerRequestApprovalSchema,
	butlerResolveSchema,
	butlerSendSchema,
	butlerStateQuerySchema,
	butlerThreadListSchema,
} from "@jedv/shared/butler";
import {
	attentionIgnoreSchema,
	attentionQuerySchema,
	attentionSelectorSchema,
} from "@jedv/shared/butler-attention";
import { requireButler } from "../../../butler/runtime";
import { protectedProcedure, router } from "../../index";
export const butlerRouter = router({
	capabilities: protectedProcedure.query(() => ({
		protocolVersion: 1,
		features: {
			requestApproval: true,
			attention: true,
			conversationState: true,
			toolProgress: true,
			historyByRequest: true,
		},
	})),
	state: protectedProcedure
		.input(butlerStateQuerySchema)
		.query(({ ctx, input }) => requireButler(ctx).state(input)),
	attention: protectedProcedure
		.input(attentionQuerySchema)
		.query(({ ctx, input }) => requireButler(ctx).attention(input)),
	markAttentionRead: protectedProcedure
		.input(attentionSelectorSchema)
		.mutation(({ ctx, input }) => requireButler(ctx).markAttentionRead(input)),
	ignoreAttention: protectedProcedure
		.input(attentionIgnoreSchema)
		.mutation(({ ctx, input }) => requireButler(ctx).ignoreAttention(input)),
	requestApproval: protectedProcedure
		.input(butlerRequestApprovalSchema)
		.mutation(({ ctx, input }) => requireButler(ctx).requestApproval(input)),
	sendMessage: protectedProcedure
		.input(butlerSendSchema)
		.mutation(({ ctx, input }) => requireButler(ctx).sendMessage(input)),
	listThreads: protectedProcedure
		.input(butlerThreadListSchema)
		.query(({ ctx, input }) => requireButler(ctx).listThreads(input)),
	history: protectedProcedure
		.input(butlerHistorySchema)
		.query(({ ctx, input }) => requireButler(ctx).history(input)),
	listApprovals: protectedProcedure
		.input(butlerApprovalListSchema)
		.query(({ ctx, input }) =>
			requireButler(ctx).listApprovalsWithSources(input),
		),
	resolveApproval: protectedProcedure
		.input(butlerResolveSchema)
		.mutation(({ ctx, input }) => requireButler(ctx).resolveApproval(input)),
	inbox: protectedProcedure.query(({ ctx }) => requireButler(ctx).inbox()),
});
