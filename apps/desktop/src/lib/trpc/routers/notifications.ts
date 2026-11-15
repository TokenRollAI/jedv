import { TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import {
	type BrowserWindow,
	type Notification as ElectronNotification,
	Notification,
} from "electron";
import {
	connectedOrigin,
	enqueueMainNavigation,
	publishVisibility,
	requireMainWindow,
	sourceIsVisible,
	windowHostOrigin,
} from "main/lib/main-events";
import { parseLocalDeepLink } from "main/lib/main-events/core";
import {
	type AgentLifecycleEvent,
	type NotificationIds,
	notificationsEmitter,
} from "main/lib/notifications/server";
import { NOTIFICATION_EVENTS } from "shared/constants";
import {
	type MainNavigationTarget,
	mainEventIdSchema,
	mainVisibilitySchema,
} from "shared/main-events";
import { z } from "zod";
import { publicProcedure, router } from "..";

type TerminalExitNotification = NotificationIds & {
	exitCode: number;
	signal?: number;
	reason?: "killed" | "exited" | "error";
};
type NotificationReply = { target: string; text: string; windowId?: number };
type NotificationEvent =
	| {
			type: typeof NOTIFICATION_EVENTS.AGENT_LIFECYCLE;
			data?: AgentLifecycleEvent;
	  }
	| {
			type: typeof NOTIFICATION_EVENTS.TERMINAL_EXIT;
			data?: TerminalExitNotification;
	  }
	| {
			type: typeof NOTIFICATION_EVENTS.SETTINGS_EXTERNAL_CHANGE;
			data?: { themeState?: unknown };
	  }
	| {
			type: typeof NOTIFICATION_EVENTS.NOTIFICATION_REPLY;
			data?: { target: string; text: string };
	  };
const showNativeInputSchema = z
	.object({
		title: z.string().min(1).max(256),
		subtitle: z.string().max(256).optional(),
		body: z.string().max(4096),
		silent: z.boolean().default(true),
		clickTarget: z
			.object({
				hostUrl: z.string().max(2048).optional(),
				workspaceId: mainEventIdSchema,
				source: z.object({
					type: z.enum(["terminal", "chat"]),
					id: mainEventIdSchema,
				}),
			})
			.optional(),
		clickPath: z.string().max(2048).startsWith("/").optional(),
		id: mainEventIdSchema.optional(),
		groupId: mainEventIdSchema.optional(),
		replyTarget: mainEventIdSchema.optional(),
	})
	.strict();
const activeNativeNotifications = new Map<string, ElectronNotification>();
export const createNotificationsRouter = (
	_getWindow: () => BrowserWindow | null,
) =>
	router({
		publishVisibility: publicProcedure
			.input(mainVisibilitySchema)
			.mutation(({ ctx, input }) => {
				publishVisibility(ctx.senderWindow, input);
				return { success: true as const };
			}),
		showNative: publicProcedure
			.input(showNativeInputSchema)
			.mutation(({ ctx, input }) => {
				const window = requireMainWindow(ctx.senderWindow),
					windowId = window.id;
				let target: MainNavigationTarget | undefined;
				if (input.clickPath) {
					const parsed = parseLocalDeepLink(
						`jedv://${input.clickPath.slice(1)}`,
					);
					if (!parsed || "hostUrl" in parsed)
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: "Use a host-bound clickTarget for workspace navigation",
						});
					target = parsed;
				}
				if (input.clickTarget) {
					if (input.clickTarget.source.type !== "terminal")
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message: "Chat notification navigation is not available",
						});
					const origin = input.clickTarget.hostUrl
						? connectedOrigin(input.clickTarget.hostUrl)
						: windowHostOrigin(window);
					if (!origin)
						throw new TRPCError({
							code: "PRECONDITION_FAILED",
							message:
								"Publish the connected host before showing a workspace notification",
						});
					target = {
						kind: "workspace",
						hostUrl: origin,
						workspaceId: input.clickTarget.workspaceId,
						terminalId: input.clickTarget.source.id,
					};
					if (sourceIsVisible(target))
						return { success: true as const, suppressed: true as const };
				}
				if (!Notification.isSupported())
					return { success: false as const, reason: "unsupported" as const };
				const notification = new Notification({
					title: input.title,
					subtitle: process.platform === "darwin" ? input.subtitle : undefined,
					body:
						process.platform !== "darwin" && input.subtitle
							? `${input.subtitle}\n${input.body}`
							: input.body,
					silent: input.silent,
					id: input.id,
					groupId: input.groupId,
					hasReply: input.replyTarget !== undefined,
				});
				const key = `${windowId}:${input.id ?? (target?.kind === "workspace" ? `${target.hostUrl}:${target.workspaceId}:${target.terminalId}` : crypto.randomUUID())}`;
				activeNativeNotifications.get(key)?.close();
				if (activeNativeNotifications.size >= 64) {
					const oldest = activeNativeNotifications.entries().next().value;
					if (oldest) {
						oldest[1].close();
						activeNativeNotifications.delete(oldest[0]);
					}
				}
				activeNativeNotifications.set(key, notification);
				const untrack = () => {
					if (activeNativeNotifications.get(key) === notification)
						activeNativeNotifications.delete(key);
				};
				notification.on("close", untrack);
				notification.on("click", () => {
					untrack();
					if (target)
						enqueueMainNavigation(
							"notification",
							target,
							window.isDestroyed() ? undefined : window,
						);
					else if (!window.isDestroyed()) {
						if (window.isMinimized()) window.restore();
						window.show();
						window.focus();
					}
				});
				const replyTarget = input.replyTarget;
				if (replyTarget)
					notification.on("reply", (details) => {
						const text = details.reply.trim().slice(0, 4096);
						if (text)
							notificationsEmitter.emit(
								NOTIFICATION_EVENTS.NOTIFICATION_REPLY,
								{ target: replyTarget, text, windowId },
							);
					});
				notification.show();
				return { success: true as const };
			}),
		closeGroup: publicProcedure
			.input(z.object({ groupId: mainEventIdSchema }))
			.mutation(({ ctx, input }) => {
				requireMainWindow(ctx.senderWindow);
				if (process.platform === "darwin" || process.platform === "win32")
					Notification.removeGroup(input.groupId);
				return { success: true as const };
			}),
		subscribe: publicProcedure.subscription(({ ctx }) => {
			const window = requireMainWindow(ctx.senderWindow);
			return observable<NotificationEvent>((emit) => {
				const lifecycle = (data: AgentLifecycleEvent) =>
					emit.next({ type: NOTIFICATION_EVENTS.AGENT_LIFECYCLE, data });
				const exit = (data: TerminalExitNotification) =>
					emit.next({ type: NOTIFICATION_EVENTS.TERMINAL_EXIT, data });
				const settings = (data: { themeState?: unknown }) =>
					emit.next({
						type: NOTIFICATION_EVENTS.SETTINGS_EXTERNAL_CHANGE,
						data,
					});
				const reply = (data: NotificationReply) => {
					if (data.windowId === window.id)
						emit.next({
							type: NOTIFICATION_EVENTS.NOTIFICATION_REPLY,
							data: { target: data.target, text: data.text },
						});
				};
				const handlers = [
					[NOTIFICATION_EVENTS.AGENT_LIFECYCLE, lifecycle],
					[NOTIFICATION_EVENTS.TERMINAL_EXIT, exit],
					[NOTIFICATION_EVENTS.SETTINGS_EXTERNAL_CHANGE, settings],
					[NOTIFICATION_EVENTS.NOTIFICATION_REPLY, reply],
				] as const;
				for (const [name, handler] of handlers)
					notificationsEmitter.on(name, handler);
				const cleanup = () => {
					for (const [name, handler] of handlers)
						notificationsEmitter.off(name, handler);
				};
				const closed = () => {
					cleanup();
					emit.complete();
				};
				window.once("closed", closed);
				return () => {
					cleanup();
					window.removeListener("closed", closed);
				};
			});
		}),
	});
