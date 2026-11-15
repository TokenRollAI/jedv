import { peerOriginSchema } from "@jedv/shared/teamwork-peers";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { HostServiceContext } from "../../../types";
import { protectedProcedure, router } from "../../index";
export function requireMobile(ctx: HostServiceContext) {
	if (!ctx.runtime.mobileAuth)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Mobile auth is unavailable",
		});
	return ctx.runtime.mobileAuth;
}
export const mobileAuthRouter = router({
	capabilities: protectedProcedure.query(() => ({
		protocolVersion: 1 as const,
	})),
	getOrigin: protectedProcedure.query(({ ctx }) =>
		requireMobile(ctx).getOrigin(),
	),
	setOrigin: protectedProcedure
		.input(z.object({ origin: peerOriginSchema.nullable() }).strict())
		.mutation(({ ctx, input }) => requireMobile(ctx).setOrigin(input)),
	createPairingCode: protectedProcedure.mutation(({ ctx }) =>
		requireMobile(ctx).createPairingCode(),
	),
	listSessions: protectedProcedure.query(({ ctx }) =>
		requireMobile(ctx).listSessions(),
	),
	revokeSession: protectedProcedure
		.input(z.object({ sessionId: z.string().uuid() }))
		.mutation(({ ctx, input }) =>
			requireMobile(ctx).revokeSession(input.sessionId),
		),
	revokeAllSessions: protectedProcedure.mutation(({ ctx }) =>
		requireMobile(ctx).revokeAllSessions(),
	),
});
