import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
	AgentIslandApprovalEvent,
	AgentIslandApprovalInput,
	AgentIslandEntry,
	AgentIslandState,
} from "shared/types/agent-island";

function conflict(message: string): never {
	throw new TRPCError({ code: "CONFLICT", message });
}

export class AgentIslandProjection {
	binding: AgentIslandState["binding"] = null;
	entries: AgentIslandEntry[] = [];
	revision = 0;
	private consumed = new Set<string>();
	private actions = new Set<string>();

	bind(windowId: number, hostId: string): void {
		if (this.binding?.windowId === windowId && this.binding.hostId === hostId)
			return;
		this.clear();
		this.binding = { windowId, hostId };
	}

	clear(): void {
		this.binding = null;
		this.entries = [];
		this.consumed.clear();
		this.actions.clear();
		this.revision++;
	}

	assertPublisher(windowId: number, hostId?: string): void {
		if (
			!this.binding ||
			this.binding.windowId !== windowId ||
			(hostId !== undefined && this.binding.hostId !== hostId)
		)
			conflict("Island host/window binding changed");
	}

	publish(windowId: number, hostId: string, entries: AgentIslandEntry[]): void {
		this.assertPublisher(windowId, hostId);
		this.entries = entries;
		this.revision++;
	}

	entry(entryId: string): AgentIslandEntry {
		const entry = this.entries.find((item) => item.entryId === entryId);
		if (!entry)
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Island entry no longer exists",
			});
		return entry;
	}

	approve(input: AgentIslandApprovalInput): AgentIslandApprovalEvent {
		const entry = this.entry(input.entryId);
		if (
			!this.binding ||
			entry.activeWriter !== "control" ||
			!entry.profileHash ||
			!entry.nativeSessionId
		)
			conflict("Return to the CLI terminal to handle this request");
		if (
			this.binding.hostId !== input.hostId ||
			entry.profileHash !== input.profileHash ||
			entry.nativeSessionId !== input.nativeSessionId ||
			entry.leaseEpoch !== input.expectedLeaseEpoch ||
			!entry.pendingApprovals.some((item) => item.requestId === input.requestId)
		)
			conflict("Native session, lease or pending approval changed");
		const key = JSON.stringify([
			entry.workspaceId,
			entry.provider,
			entry.profileHash,
			entry.nativeSessionId,
			entry.leaseEpoch,
			input.requestId,
		]);
		if (this.consumed.has(key)) conflict("Approval was already forwarded");
		if (this.consumed.size >= 1024 || this.actions.size >= 256)
			conflict("Island approval capacity reached; return to the workspace");
		this.consumed.add(key);
		const actionId = randomUUID();
		this.actions.add(actionId);
		return {
			actionId,
			hostId: this.binding.hostId,
			workspaceId: entry.workspaceId,
			provider: entry.provider,
			...(entry.agentConfigId ? { agentConfigId: entry.agentConfigId } : {}),
			nativeSessionId: entry.nativeSessionId,
			profileHash: entry.profileHash,
			expectedLeaseEpoch: entry.leaseEpoch,
			requestId: input.requestId,
			decision: input.decision,
		};
	}

	complete(windowId: number, actionId: string): void {
		this.assertPublisher(windowId);
		if (!this.actions.delete(actionId))
			conflict("Approval action already completed or binding changed");
	}
}

export function islandActivityCounts(entries: readonly AgentIslandEntry[]) {
	return {
		running: entries.filter((entry) => entry.turnState === "running").length,
		approvals: entries.reduce(
			(count, entry) =>
				count +
				Math.max(
					entry.pendingApprovals.length,
					entry.turnState === "awaiting-approval" ? 1 : 0,
				),
			0,
		),
		completed: entries.filter((entry) => entry.completedUnread).length,
	};
}

export function islandPopoverBounds(
	area: { x: number; y: number; width: number; height: number },
	anchor: { x: number; y: number; width: number; height: number },
) {
	const width = Math.min(380, area.width);
	const height = Math.min(280, area.height);
	return {
		x: Math.round(
			Math.max(
				area.x,
				Math.min(
					area.x + area.width - width,
					anchor.x + anchor.width / 2 - width / 2,
				),
			),
		),
		y: Math.round(
			Math.max(
				area.y,
				Math.min(area.y + area.height - height, anchor.y + anchor.height + 6),
			),
		),
		width,
		height,
	};
}
