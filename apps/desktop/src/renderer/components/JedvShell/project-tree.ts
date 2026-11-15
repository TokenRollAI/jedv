import type { Project, Workspace } from "./types";
export type WorkspaceSortMode = "manual" | "active" | "created";
export interface ProjectTreeOptions {
	sort?: WorkspaceSortMode;
	manualOrder?: readonly string[];
	pinnedIds?: ReadonlySet<string>;
}
function stamp(value: Date | number | string | null | undefined): number {
	return value instanceof Date
		? value.getTime()
		: typeof value === "number"
			? value
			: typeof value === "string"
				? Date.parse(value) || 0
				: 0;
}
export function sortWorkspaces(
	workspaces: Workspace[],
	options: ProjectTreeOptions = {},
) {
	const manual = new Map(options.manualOrder?.map((id, index) => [id, index]));
	return workspaces
		.map((workspace, index) => ({ workspace, index }))
		.sort((a, b) => {
			const pin =
				Number(options.pinnedIds?.has(b.workspace.id) ?? false) -
				Number(options.pinnedIds?.has(a.workspace.id) ?? false);
			if (pin) return pin;
			if (options.sort === "active")
				return (
					stamp(b.workspace.lastActivityAt ?? b.workspace.updatedAt) -
						stamp(a.workspace.lastActivityAt ?? a.workspace.updatedAt) ||
					a.index - b.index
				);
			if (options.sort === "created")
				return (
					stamp(b.workspace.createdAt) - stamp(a.workspace.createdAt) ||
					a.index - b.index
				);
			return (
				(manual.get(a.workspace.id) ?? Number.MAX_SAFE_INTEGER) -
					(manual.get(b.workspace.id) ?? Number.MAX_SAFE_INTEGER) ||
				a.index - b.index
			);
		})
		.map((row) => row.workspace);
}
export function groupProjects(
	projects: Project[],
	workspaces: Workspace[],
	filter: string,
	options: ProjectTreeOptions = {},
) {
	const query = filter.trim().toLowerCase();
	return projects
		.map((project) => {
			const rows = sortWorkspaces(
				workspaces.filter(
					(workspace) =>
						workspace.projectId === project.id &&
						(!query ||
							`${project.name} ${workspace.name} ${workspace.branch} ${(workspace.tags ?? []).join(" ")}`
								.toLowerCase()
								.includes(query)),
				),
				options,
			);
			const settings = project.tagSettings ?? [];
			const tags = new Set([
				...rows.flatMap((workspace) => workspace.tags ?? []),
				...settings.map((setting) => setting.tag),
			]);
			const sections = [...tags]
				.map((tag) => {
					const setting = settings.find((item) => item.tag === tag);
					return {
						tag,
						name: setting?.displayName ?? tag,
						color: setting?.color ?? null,
						order: setting?.tabOrder ?? Number.MAX_SAFE_INTEGER,
						workspaces: rows.filter((workspace) =>
							workspace.tags?.includes(tag),
						),
					};
				})
				.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
			return {
				project,
				workspaces: rows,
				sections,
				ungrouped: rows.filter((workspace) => !workspace.tags?.length),
			};
		})
		.filter(
			(group) =>
				!query ||
				group.project.name.toLowerCase().includes(query) ||
				group.workspaces.length > 0,
		);
}
