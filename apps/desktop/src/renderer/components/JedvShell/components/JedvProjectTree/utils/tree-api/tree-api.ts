import type { electronTrpcClient } from "renderer/lib/trpc-client";
import type { ProjectActionContext } from "../../../JedvProjectActions";
import type { TreeGroup } from "../tree-layout";
export type TreeNativeClient = Pick<
	typeof electronTrpcClient,
	"portForwards" | "external" | "settings"
>;
export async function stopTreeWorkspaceForwards(
	native: TreeNativeClient,
	context: ProjectActionContext,
	workspaceId: string,
	confirmedIds: readonly string[],
) {
	const current = await native.portForwards.list.query();
	const scoped = current.filter(
		(row) =>
			confirmedIds.includes(row.id) &&
			row.target.hostUrl === context.hostUrl &&
			row.target.workspaceId === workspaceId,
	);
	for (const row of scoped)
		await native.portForwards.stopForward.mutate({ id: row.id });
}
export async function openTreeEditor(
	native: TreeNativeClient,
	context: ProjectActionContext,
	path: string,
	app: Awaited<
		ReturnType<TreeNativeClient["settings"]["getDefaultEditor"]["query"]>
	>,
) {
	if (context.isRemote) return;
	await native.external.openFileInEditor.mutate({
		path,
		app: app ?? undefined,
	});
}
export async function moveTreeGroup(
	context: ProjectActionContext,
	projectId: string,
	groups: TreeGroup[],
	tag: string,
	direction: -1 | 1,
) {
	const next = [...groups];
	const from = next.findIndex((row) => row.tag === tag);
	const to = from + direction;
	if (from < 0 || to < 0 || to >= next.length) return;
	const a = next[from];
	const b = next[to];
	if (!a || !b) return;
	next[from] = b;
	next[to] = a;
	for (const [tabOrder, group] of next.entries())
		await context.client.tagFolders.upsert.mutate({
			scope: projectId,
			tag: group.tag,
			tabOrder,
		});
}

export type TreeListener = Awaited<
	ReturnType<ProjectActionContext["client"]["ports"]["getAll"]["query"]>
>[number];
export async function stopTreeWorkspaceListeners(
	context: ProjectActionContext,
	workspaceId: string,
	confirmed: readonly TreeListener[],
	messages: { changed: string; failed: string },
) {
	for (const row of confirmed) {
		if (row.workspaceId !== workspaceId) throw new Error(messages.changed);
		const fresh = await context.client.ports.getAll.query({
			workspaceIds: [workspaceId],
		});
		const current = fresh.find(
			(item) =>
				item.workspaceId === workspaceId &&
				item.terminalId === row.terminalId &&
				item.port === row.port,
		);
		if (!current) continue;
		if (
			current.pid !== row.pid ||
			current.processName !== row.processName ||
			current.address !== row.address
		)
			throw new Error(messages.changed);
		const result = await context.client.ports.kill.mutate({
			workspaceId,
			terminalId: row.terminalId,
			port: row.port,
		});
		if (!result.success) throw new Error(messages.failed);
	}
}
