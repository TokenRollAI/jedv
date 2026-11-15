import {
	agentStatusFromEvent,
	highestAgentStatus,
} from "@jedv/shared/agent-status";
import { msg } from "@lingui/core/macro";
import type { LocalClient } from "../../../local-client";
import type { Workspace } from "../../../types";
export type Binding = Awaited<
	ReturnType<LocalClient["terminalAgents"]["list"]["query"]>
>[number];
export type WorkspacePR = Awaited<
	ReturnType<LocalClient["pullRequests"]["getByWorkspaces"]["query"]>
>["workspaces"][number];
export const columns = [
	"idle",
	"working",
	"attention",
	"finished",
	"review",
	"merged",
	"deleted",
] as const;
export type Column = (typeof columns)[number];
export const columnLabels = {
	idle: msg({ message: "Idle" }),
	working: msg({ message: "Working" }),
	attention: msg({ message: "Needs attention" }),
	finished: msg({ message: "Finished · unread" }),
	review: msg({ message: "In review" }),
	merged: msg({ message: "Merged" }),
	deleted: msg({ message: "Deleted" }),
};
export const columnColors: Record<Column, string> = {
	idle: "text-muted-foreground",
	working: "text-amber-500",
	attention: "text-yellow-500",
	finished: "text-emerald-500",
	review: "text-sky-500",
	merged: "text-purple-500",
	deleted: "text-muted-foreground",
};
export function boardColumn(
	workspace: Pick<Workspace, "archivedAt" | "archiveReason">,
	bindings: Pick<Binding, "lastEventType" | "endedAt">[],
	pr: WorkspacePR["pullRequest"],
	readAt = 0,
): Column {
	if (workspace.archivedAt != null)
		return workspace.archiveReason === "merged" ? "merged" : "deleted";
	if (pr?.state === "merged") return "merged";
	const status = highestAgentStatus(
		bindings
			.filter((binding) => binding.endedAt == null)
			.map((binding) => agentStatusFromEvent(binding.lastEventType)),
	);
	if (status === "permission" || status === "failed") return "attention";
	if (status === "working") return "working";
	if (status === "review" && readAt === 0) return "finished";
	if (pr && ["open", "draft", "queued"].includes(pr.state)) return "review";
	return "idle";
}
