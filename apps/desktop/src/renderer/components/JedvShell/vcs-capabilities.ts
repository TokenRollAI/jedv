import type { VcsCapabilities } from "@jedv/shared/vcs-capabilities";

type Entity = (Partial<VcsCapabilities> & { id?: string }) | null | undefined;
export const supportsGit = (entity: Entity) =>
	!!entity && entity.vcsKind !== "none" && entity.capabilities?.git !== false;
export const supportsPullRequests = (entity: Entity) =>
	supportsGit(entity) && entity?.capabilities?.pullRequests !== false;
export const supportsWorktrees = (entity: Entity) =>
	supportsGit(entity) && entity?.capabilities?.worktrees !== false;
