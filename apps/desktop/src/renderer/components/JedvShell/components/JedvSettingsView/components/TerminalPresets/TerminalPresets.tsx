import { errorMessage } from "@jedv/i18n/errors";
import type { TerminalPreset } from "@jedv/local-db/schema/zod";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@jedv/ui/alert-dialog";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { resolvePresetAgentLink } from "renderer/lib/linked-terminal-presets";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { JedvParityViewContext } from "../../../../parity-types";
import { PresetEditor } from "./components/PresetEditor/PresetEditor";

export function TerminalPresets({
	projects,
	remote,
	client,
	hostUrl,
}: JedvParityViewContext) {
	const { t } = useLingui();
	const utils = electronTrpc.useUtils();
	const presets = electronTrpc.settings.getTerminalPresets.useQuery();
	const agents = useQuery({
		queryKey: ["jedv-settings", hostUrl, "agent-configs"],
		queryFn: () => client.settings.agentConfigs.list.query(),
		enabled: !remote,
	});
	const [editing, setEditing] = useState<TerminalPreset | "new" | null>(null);
	const [deleting, setDeleting] = useState<TerminalPreset | null>(null);
	const refresh = async () => {
		await utils.settings.getTerminalPresets.invalidate();
	};
	const remove = useMutation({
		mutationFn: (id: string) =>
			electronTrpcClient.settings.deleteTerminalPreset.mutate({ id }),
		onSuccess: refresh,
	});
	const reorder = useMutation({
		mutationFn: (input: { presetId: string; targetIndex: number }) =>
			electronTrpcClient.settings.reorderTerminalPresets.mutate(input),
		onSuccess: refresh,
	});
	const error =
		remove.error ??
		reorder.error ??
		presets.error ??
		(!remote ? agents.error : null);
	return (
		<section className="space-y-3">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">
					<Trans>Terminal presets</Trans>
				</h3>
				<Button
					variant="outline"
					size="sm"
					disabled={!!editing || !!remote}
					onClick={() => setEditing("new")}
				>
					<Trans>Add preset</Trans>
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				<Trans>
					Presets are stored on this device. Run them explicitly from the
					workspace launcher.
				</Trans>
			</p>
			{remote && (
				<p className="text-xs text-muted-foreground">
					<Trans>
						Switch to this device to edit terminal presets and choose local
						projects.
					</Trans>
				</p>
			)}
			{presets.isPending && (
				<output className="text-xs text-muted-foreground">
					<Trans>Loading…</Trans>
				</output>
			)}
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{errorMessage(error)}
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							void presets.refetch();
							if (!remote) void agents.refetch();
						}}
					>
						<Trans>Retry</Trans>
					</Button>
				</p>
			)}
			{editing && !remote && (
				<PresetEditor
					key={editing === "new" ? "new" : editing.id}
					preset={editing === "new" ? null : editing}
					projects={projects}
					agents={agents.data ?? []}
					agentsPending={agents.isPending}
					readPresets={() =>
						electronTrpcClient.settings.getTerminalPresets.query()
					}
					loadAgents={() => client.settings.agentConfigs.list.query()}
					onCancel={() => setEditing(null)}
					onSaved={async () => {
						await refresh();
						setEditing(null);
					}}
				/>
			)}
			<div className="divide-y overflow-hidden rounded-lg border border-border">
				{presets.data?.map((preset, index) => {
					const link = resolvePresetAgentLink(preset, agents.data ?? [], {
						remote: !!remote,
					});
					return (
						<div
							className="flex flex-wrap items-center gap-2 p-4"
							key={preset.id}
						>
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{preset.name}</p>
								{preset.description && (
									<p className="text-xs text-muted-foreground">
										{preset.description}
									</p>
								)}
								{link.status !== "unlinked" && (
									<p
										className={`text-xs ${link.status === "linked" ? "text-muted-foreground" : "text-destructive"}`}
									>
										{link.status === "linked" ? (
											<>
												<Trans>Linked agent</Trans>: {link.agent.label}
											</>
										) : link.status === "remote" ? (
											<Trans>Linked presets cannot run on remote hosts.</Trans>
										) : link.status === "ambiguous" ? (
											<Trans>More than one agent matches this preset.</Trans>
										) : agents.isPending ? (
											<Trans>Loading…</Trans>
										) : (
											<Trans>Linked agent is unavailable.</Trans>
										)}
									</p>
								)}
							</div>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t({ message: "Move preset up" })}
								disabled={
									!!remote || !!editing || index === 0 || reorder.isPending
								}
								onClick={() =>
									reorder.mutate({
										presetId: preset.id,
										targetIndex: index - 1,
									})
								}
							>
								<ArrowUp className="size-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t({ message: "Move preset down" })}
								disabled={
									!!remote ||
									!!editing ||
									index === (presets.data?.length ?? 0) - 1 ||
									reorder.isPending
								}
								onClick={() =>
									reorder.mutate({
										presetId: preset.id,
										targetIndex: index + 1,
									})
								}
							>
								<ArrowDown className="size-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={!!remote || !!editing}
								onClick={() => setEditing(preset)}
							>
								<Trans>Edit</Trans>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={!!remote || !!editing || remove.isPending}
								onClick={() => setDeleting(preset)}
							>
								<Trans>Delete</Trans>
							</Button>
						</div>
					);
				})}
				{presets.data?.length === 0 && (
					<p className="p-4 text-xs text-muted-foreground">
						<Trans>No terminal presets yet.</Trans>
					</p>
				)}
			</div>
			<AlertDialog
				open={!!deleting}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Delete this preset?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>
								This removes the saved commands from this device. Running
								terminals are not affected.
							</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (deleting) remove.mutate(deleting.id);
							}}
						>
							<Trans>Delete</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
