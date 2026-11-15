import {
	type ProjectTreeOptions,
	sortWorkspaces,
} from "../../../../project-tree";
import type { Project, Workspace } from "../../../../types";
export interface TreeGroup {
	tag: string;
	name: string;
	color: string | null;
	order: number;
}
export interface TreeLane {
	key: string;
	group: TreeGroup | null;
	pinned: boolean;
	workspaces: Workspace[];
}
export function projectTreeLanes(
	workspaces: Workspace[],
	groups: TreeGroup[],
	options: ProjectTreeOptions,
): TreeLane[] {
	const sorted = sortWorkspaces(
		workspaces.filter((row) => row.archivedAt == null),
		options,
	);
	const pinned = sorted.filter((row) => options.pinnedIds?.has(row.id));
	const rest = sorted.filter((row) => !options.pinnedIds?.has(row.id));
	const assigned = new Set<string>();
	const lanes = groups.map((group) => {
		const rows = rest.filter(
			(row) => !assigned.has(row.id) && row.tags?.includes(group.tag),
		);
		for (const row of rows) assigned.add(row.id);
		return { key: `tag:${group.tag}`, group, pinned: false, workspaces: rows };
	});
	return [
		...(pinned.length
			? [{ key: "pinned", group: null, pinned: true, workspaces: pinned }]
			: []),
		{
			key: "ungrouped",
			group: null,
			pinned: false,
			workspaces: rest.filter((row) => !assigned.has(row.id)),
		},
		...lanes,
	];
}
export function treeGroups(
	workspaces: Workspace[],
	settings: Project["tagSettings"],
): TreeGroup[] {
	const tags = new Set([
		...settings.map((row) => row.tag),
		...workspaces.flatMap((row) => row.tags ?? []),
	]);
	return [...tags]
		.map((tag) => {
			const row = settings.find((item) => item.tag === tag);
			return {
				tag,
				name: row?.displayName ?? tag,
				color: row?.color ?? null,
				order: row?.tabOrder ?? Number.MAX_SAFE_INTEGER,
			};
		})
		.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
export function matchesTreeFilter(
	projectName: string,
	workspace: Workspace,
	filter: string,
	groups: TreeGroup[],
) {
	const query = filter.trim().toLowerCase();
	return (
		!query ||
		`${projectName} ${workspace.name} ${workspace.branch} ${(workspace.tags ?? []).map((tag) => `${tag} ${groups.find((row) => row.tag === tag)?.name ?? ""}`).join(" ")}`
			.toLowerCase()
			.includes(query)
	);
}
export function sameTreeLaneOrder(lanes: TreeLane[], next: readonly string[]) {
	const before = lanes.flatMap((lane) =>
		lane.workspaces.map((row) => ({ id: row.id, lane: lane.key })),
	);
	const byId = new Map(before.map((row) => [row.id, row.lane]));
	return (
		before.length === next.length &&
		new Set(next).size === before.length &&
		next.every((id, index) => byId.get(id) === before[index]?.lane)
	);
}
