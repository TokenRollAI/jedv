import { agentIslandManager } from "main/windows/agent-island";
import {
	agentIslandApprovalSchema,
	agentIslandFocusSchema,
	agentIslandHostSchema,
	agentIslandPreferencesSchema,
	agentIslandSnapshotSchema,
} from "shared/types/agent-island";
import { z } from "zod";
import { publicProcedure, router } from "../..";

export const createAgentIslandRouter = () =>
	router({
		getState: publicProcedure.query(({ ctx }) => {
			agentIslandManager.assertReader(ctx.senderWindow);
			return agentIslandManager.state();
		}),
		setEnabled: publicProcedure
			.input(agentIslandPreferencesSchema.pick({ enabled: true }))
			.mutation(({ ctx, input }) => {
				agentIslandManager.assertMain(ctx.senderWindow);
				return agentIslandManager.configure(input);
			}),
		bindHost: publicProcedure
			.input(agentIslandHostSchema)
			.mutation(({ ctx, input }) => {
				const window = agentIslandManager.assertMain(ctx.senderWindow);
				return agentIslandManager.bind(window, input.hostId);
			}),
		publishSnapshot: publicProcedure
			.input(agentIslandSnapshotSchema)
			.mutation(({ ctx, input }) => {
				const window = agentIslandManager.assertMain(ctx.senderWindow);
				return agentIslandManager.publish(window, input);
			}),
		dismiss: publicProcedure.mutation(({ ctx }) => {
			agentIslandManager.assertIsland(ctx.senderWindow);
			agentIslandManager.hide();
			return { ok: true };
		}),
		focusWorkspaceTerminal: publicProcedure
			.input(agentIslandFocusSchema)
			.mutation(({ ctx, input }) => {
				agentIslandManager.assertIsland(ctx.senderWindow);
				agentIslandManager.focus(input.entryId, input.hostId);
				return { ok: true };
			}),
		requestApproval: publicProcedure
			.input(agentIslandApprovalSchema)
			.mutation(({ ctx, input }) => {
				agentIslandManager.assertIsland(ctx.senderWindow);
				return agentIslandManager.approve(input);
			}),
		completeApproval: publicProcedure
			.input(z.strictObject({ actionId: z.string().uuid(), ok: z.boolean() }))
			.mutation(({ ctx, input }) => {
				const window = agentIslandManager.assertMain(ctx.senderWindow);
				agentIslandManager.complete(window, input);
				return { ok: true };
			}),
	});
