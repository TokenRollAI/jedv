export type VcsKind = "git" | "none";

export interface VcsCapabilities {
	vcsKind: VcsKind;
	capabilities: { git: boolean; pullRequests: boolean; worktrees: boolean };
}

export function vcsCapabilities(vcsKind: VcsKind): VcsCapabilities {
	const enabled = vcsKind === "git";
	return {
		vcsKind,
		capabilities: { git: enabled, pullRequests: enabled, worktrees: enabled },
	};
}
