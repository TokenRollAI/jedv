import {
	PANE_LAYOUT_ERROR_CODES,
	type PaneLayoutOpResult,
} from "@jedv/shared/pane-layout-ops";
import { observable } from "@trpc/server/observable";
import {
	type PaneLayoutRendererRequest,
	paneLayoutRequests,
} from "main/lib/pane-layout/pane-layout-requests";
import { z } from "zod";
import { publicProcedure, router } from "../..";

export const createPaneLayoutRouter = () => {
	return router({
		// Layout ops from the CLI (via the bridge), scoped to the one window
		// main picked for each request.
		onRequest: publicProcedure.subscription(({ ctx }) => {
			return observable<PaneLayoutRendererRequest>((emit) => {
				const contents = ctx.senderWindow?.webContents;
				const webContentsId = contents?.id;
				if (!contents || webContentsId === undefined) return () => {};
				const registration = paneLayoutRequests.addSubscriber(webContentsId);
				const handler = (request: PaneLayoutRendererRequest) => {
					if (
						request.targetWebContentsId === webContentsId &&
						request.targetSubscriptionId === registration.subscriptionId
					) {
						emit.next(request);
					}
				};
				paneLayoutRequests.on("request", handler);
				const cleanup = () => {
					contents.removeListener("destroyed", cleanup);
					paneLayoutRequests.off("request", handler);
					registration.unsubscribe();
				};
				contents.once("destroyed", cleanup);
				return cleanup;
			});
		}),

		bindWorkspace: publicProcedure
			.input(z.object({ workspaceId: z.string().min(1).nullable() }))
			.mutation(({ ctx, input }) => {
				const id = ctx.senderWindow?.webContents.id;
				if (id !== undefined)
					paneLayoutRequests.setWorkspace(id, input.workspaceId);
				return { success: true };
			}),

		respond: publicProcedure
			.input(
				z.object({
					requestId: z.string(),
					result: z.custom<PaneLayoutOpResult>().optional(),
					error: z
						.object({
							code: z.enum(PANE_LAYOUT_ERROR_CODES).optional(),
							message: z.string(),
						})
						.optional(),
				}),
			)
			.mutation(({ ctx, input }) => {
				paneLayoutRequests.respond(
					input,
					ctx.senderWindow?.webContents.id ?? null,
				);
				return { success: true };
			}),
	});
};
