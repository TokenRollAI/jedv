import type { AgentIslandEntry } from "shared/types/agent-island";

interface Publisher {
	hostId: string;
	entries: readonly AgentIslandEntry[];
}
interface Receipt {
	epoch: number;
	through: number;
	unknownRead: boolean;
}
export interface DockBadgeState {
	count: number;
	dot: boolean;
	bounce: false;
}
export class DockAttention {
	private publishers = new Map<number, Publisher>();
	private receipts = new Map<string, Receipt>();
	private readRequests = new Map<string, true>();
	private last: DockBadgeState = { count: 0, dot: false, bounce: false };
	constructor(
		private deps: {
			write(state: DockBadgeState): void;
			visible(hostId: string, entry: AgentIslandEntry): boolean;
			connected?(hostId: string): boolean;
		},
	) {}
	publish(
		windowId: number,
		hostId: string,
		entries: readonly AgentIslandEntry[],
	): void {
		if (entries.length > 32) throw new Error("Attention entry limit reached");
		if (!this.publishers.has(windowId) && this.publishers.size >= 20)
			throw new Error("Attention window limit reached");
		this.publishers.set(windowId, { hostId, entries });
		this.reconcile();
	}
	clear(windowId: number, hostId?: string): void {
		if (hostId && this.publishers.get(windowId)?.hostId !== hostId) return;
		this.publishers.delete(windowId);
		this.reconcile();
	}
	state(): DockBadgeState {
		return { ...this.last };
	}
	readThrough(windowId: number): Record<string, number> {
		const publisher = this.publishers.get(windowId);
		if (!publisher) return {};
		return Object.fromEntries(
			publisher.entries.map((entry) => [
				entry.entryId,
				this.receipts.get(identity(publisher.hostId, entry))?.through ?? 0,
			]),
		);
	}
	readEntries(windowId: number): string[] {
		const publisher = this.publishers.get(windowId);
		return (
			publisher?.entries
				.filter(
					(entry) =>
						this.receipts.get(identity(publisher.hostId, entry))?.unknownRead &&
						entry.completedUnread &&
						entry.attention?.event?.kind !== "completed",
				)
				.map((entry) => entry.entryId) ?? []
		);
	}
	reconcile(): void {
		const grouped = new Map<
			string,
			{ hostId: string; entries: AgentIslandEntry[] }
		>();
		for (const publisher of this.publishers.values()) {
			if (this.deps.connected && !this.deps.connected(publisher.hostId))
				continue;
			for (const entry of publisher.entries) {
				const key = identity(publisher.hostId, entry),
					group = grouped.get(key);
				if (group) group.entries.push(entry);
				else grouped.set(key, { hostId: publisher.hostId, entries: [entry] });
			}
		}
		let count = 0,
			dot = false;
		for (const [key, { hostId, entries }] of grouped) {
			const epoch = Math.max(...entries.map((entry) => entry.leaseEpoch));
			let receipt = this.receipts.get(key);
			if (receipt && receipt.epoch > epoch) continue;
			if (!receipt || receipt.epoch < epoch) {
				receipt = { epoch, through: receipt?.through ?? 0, unknownRead: false };
				this.receipts.delete(key);
				this.receipts.set(key, receipt);
			}
			const current = entries.filter((entry) => entry.leaseEpoch === epoch);
			const visible = current.some((entry) => this.deps.visible(hostId, entry));
			if (visible)
				receipt.through = Math.max(
					receipt.through,
					...current.map((entry) =>
						Math.max(
							entry.attention?.observedAt ?? 0,
							entry.attention?.event?.occurredAt ?? 0,
						),
					),
				);
			const requests = new Set<string>(),
				completed = new Set<string>();
			let unknown = false;
			for (const entry of current) {
				const event = entry.attention?.event;

				for (const approval of entry.pendingApprovals) {
					const request = JSON.stringify([key, epoch, approval.requestId]);
					if (visible) this.readRequests.set(request, true);
					if (!this.readRequests.has(request)) requests.add(request);
				}
				if (entry.completedUnread) {
					if (event?.kind === "completed") {
						if (event.occurredAt > receipt.through) completed.add(event.marker);
					} else unknown = true;
				}
				if (
					entry.turnState === "awaiting-approval" &&
					!entry.pendingApprovals.length
				) {
					if (event?.kind === "awaiting-response") {
						if (event.occurredAt > receipt.through)
							requests.add(JSON.stringify([key, epoch, event.marker]));
					} else unknown = true;
				}
			}
			if (visible) receipt.unknownRead = true;
			if (
				!current.some(
					(entry) =>
						entry.completedUnread || entry.turnState === "awaiting-approval",
				)
			)
				receipt.unknownRead = false;
			const completeIdentity = current.every(
				(entry) => !!entry.nativeSessionId && !!entry.profileHash,
			);
			const unidentified =
				!completeIdentity && (requests.size > 0 || completed.size > 0);
			if (!unidentified) count += requests.size + Math.min(1, completed.size);
			if (unidentified || (unknown && !receipt.unknownRead)) dot = true;
		}
		while (this.receipts.size > 1024) {
			const key = this.receipts.keys().next().value;
			if (key) this.receipts.delete(key);
		}
		while (this.readRequests.size > 8192) {
			const key = this.readRequests.keys().next().value;
			if (key) this.readRequests.delete(key);
		}
		const next: DockBadgeState = { count: dot ? 0 : count, dot, bounce: false };
		if (next.count !== this.last.count || next.dot !== this.last.dot) {
			this.last = next;
			this.deps.write({ ...next });
		}
	}
	dispose(): void {
		this.publishers.clear();
		this.receipts.clear();
		this.readRequests.clear();
		this.last = { count: 0, dot: false, bounce: false };
		this.deps.write(this.state());
	}
}
function identity(hostId: string, entry: AgentIslandEntry): string {
	return JSON.stringify([
		hostId,
		entry.provider,
		entry.profileHash,
		entry.nativeSessionId ?? entry.terminalId ?? entry.entryId,
	]);
}
