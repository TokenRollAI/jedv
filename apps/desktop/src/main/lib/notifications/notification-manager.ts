import { i18n } from "@jedv/i18n";
import { msg } from "@lingui/core/macro";
import type {
	AgentLifecycleEvent,
	NotificationIds,
} from "shared/notification-types";

const NOTIFICATION_TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface NativeNotification {
	show(): void;
	close(): void;
	on(event: "click", handler: () => void): void;
	on(event: "close", handler: () => void): void;
}

export interface NotificationManagerDeps {
	isSupported: () => boolean;
	createNotification: (opts: {
		title: string;
		body: string;
		silent: boolean;
	}) => NativeNotification;
	playSound: () => void;
	onNotificationClick: (ids: NotificationIds) => void;
	isSourceVisible: (event: AgentLifecycleEvent) => boolean;
	getWorkspaceName: (workspaceId: string | undefined) => string;
	getNotificationTitle: (event: AgentLifecycleEvent) => string;
}

interface TrackedEntry {
	notification: NativeNotification;
	createdAt: number;
}

export class NotificationManager {
	private active = new Map<string, TrackedEntry>();
	private counter = 0;
	private sweepTimer: ReturnType<typeof setInterval> | null = null;

	constructor(private deps: NotificationManagerDeps) {}

	start(): void {
		if (this.sweepTimer) return;
		this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
	}

	handleAgentLifecycle(event: AgentLifecycleEvent): void {
		if (event.eventType === "Start") return;
		if (!this.deps.isSupported()) return;

		if (this.deps.isSourceVisible(event)) return;

		const workspaceName = this.deps.getWorkspaceName(event.workspaceId);
		const title = this.deps.getNotificationTitle(event);

		const isPermissionRequest = event.eventType === "PermissionRequest";
		const isPendingQuestion = event.eventType === "PendingQuestion";
		const isWaiting = isPermissionRequest || isPendingQuestion;
		const notification = this.deps.createNotification({
			title: isWaiting
				? i18n._({
						...msg({
							message: "Awaiting Response · {workspaceName}",
						}),
						values: { workspaceName },
					})
				: i18n._({
						...msg({
							message: "Agent Complete · {workspaceName}",
						}),
						values: { workspaceName },
					}),
			body: isWaiting
				? i18n._({
						...msg({
							message: '"{title}" is waiting for your reply',
						}),
						values: { title },
					})
				: i18n._({
						...msg({
							message: '"{title}" has finished its task',
						}),
						values: { title },
					}),
			silent: true,
		});

		const key = `${event.hostUrl ?? "local"}:${event.sessionId ?? event.terminalId ?? event.paneId ?? `_anon_${this.counter++}`}`;
		this.track(key, notification);

		this.deps.playSound();

		notification.on("click", () => {
			this.deps.onNotificationClick({
				paneId: event.paneId,
				tabId: event.tabId,
				workspaceId: event.workspaceId,
				sessionId: event.sessionId,
				...(event.terminalId ? { terminalId: event.terminalId } : {}),
				...(event.hostUrl ? { hostUrl: event.hostUrl } : {}),
			});
			this.untrack(key, notification);
		});

		notification.on("close", () => {
			this.untrack(key, notification);
		});

		notification.show();
	}

	/** Number of tracked notifications (for testing). */
	get activeCount(): number {
		return this.active.size;
	}

	dispose(): void {
		if (this.sweepTimer) {
			clearInterval(this.sweepTimer);
			this.sweepTimer = null;
		}
		for (const entry of this.active.values()) entry.notification.close();
		this.active.clear();
	}

	private track(key: string, notification: NativeNotification): void {
		const prev = this.active.get(key);
		if (prev) {
			prev.notification.close();
		}
		if (!prev && this.active.size >= 64) {
			const oldest = this.active.entries().next().value;
			if (oldest) {
				oldest[1].notification.close();
				this.active.delete(oldest[0]);
			}
		}
		this.active.set(key, { notification, createdAt: Date.now() });
	}

	private untrack(key: string, notification?: NativeNotification): void {
		const current = this.active.get(key);
		if (!current) return;
		if (notification && current.notification !== notification) return;
		this.active.delete(key);
	}

	private sweep(): void {
		const now = Date.now();
		for (const [key, entry] of this.active) {
			if (now - entry.createdAt > NOTIFICATION_TTL_MS) {
				this.active.delete(key);
			}
		}
	}
}
