export const PROJECT_ICON_NONE = "none";
export function resolveProjectIconUrl(project: {
	icon: string | null;
	repoOwner: string | null;
}): string | null {
	if (project.icon === PROJECT_ICON_NONE) return null;
	if (project.icon) return project.icon;
	return project.repoOwner
		? `https://github.com/${encodeURIComponent(project.repoOwner)}.png?size=64`
		: null;
}
