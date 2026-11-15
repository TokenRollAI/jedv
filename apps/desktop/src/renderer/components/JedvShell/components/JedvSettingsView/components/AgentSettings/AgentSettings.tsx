import { errorMessage } from "@jedv/i18n/errors";
import { getPresetById } from "@jedv/shared/host-agent-presets";
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
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { JedvParityViewContext } from "../../../../parity-types";
import { AgentConfigEditor } from "../AgentConfigEditor/AgentConfigEditor";

const DEFAULT_IDS = new Set(["claude", "codex", "agy", "kimi"]);
export function AgentSettings({
	client,
	hostUrl,
	remote,
}: JedvParityViewContext) {
	const { t } = useLingui();
	const [selected, setSelected] = useState<string | null>(null);
	const cache = useQueryClient();
	const [resetOpen, setResetOpen] = useState(false);
	const [creating, setCreating] = useState(false);
	const [filter, setFilter] = useState("");
	const configs = useQuery({
		queryKey: ["jedv-settings", hostUrl, "agent-configs"],
		queryFn: () => client.settings.agentConfigs.list.query(),
	});
	const refresh = async () => {
		await cache.invalidateQueries({
			queryKey: ["jedv-settings", hostUrl, "agent-configs"],
		});
		await cache.invalidateQueries({
			queryKey: ["jedv", hostUrl, "agent-configs"],
		});
	};
	const reorder = useMutation({
		mutationFn: (direction: number) => {
			const visibleIds = visibleRows.map((config) => config.id);
			const ids = [...visibleIds];
			const index = ids.indexOf(selectedConfig?.id ?? "");
			const next = index + direction;
			if (index < 0 || next < 0 || next >= ids.length)
				throw new Error("Invalid agent order");
			const currentId = ids[index];
			const nextId = ids[next];
			if (!currentId || !nextId) throw new Error("Invalid agent order");
			[ids[index], ids[next]] = [nextId, currentId];
			let position = 0;
			const visible = new Set(visibleIds);
			const complete = (configs.data ?? []).map((config) =>
				visible.has(config.id) ? (ids[position++] ?? config.id) : config.id,
			);
			return client.settings.agentConfigs.reorder.mutate({ ids: complete });
		},
		onSuccess: refresh,
	});
	const reset = useMutation({
		mutationFn: () => client.settings.agentConfigs.resetToDefaults.mutate(),
		onSuccess: async () => {
			setSelected(null);
			setCreating(false);
			await refresh();
		},
	});
	const rows =
		configs.data?.filter(
			(config) =>
				DEFAULT_IDS.has(config.presetId) ||
				getPresetById(config.presetId) === undefined,
		) ?? [];
	const visibleRows = rows.filter((config) =>
		config.label.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
	);
	const selectedConfig =
		visibleRows.find((row) => row.id === selected) ?? visibleRows[0];
	return (
		<div className="flex min-h-full">
			<aside className="w-56 shrink-0 border-r border-border p-4 space-y-3">
				<Input
					className="h-8 text-xs"
					aria-label={t({ message: "Filter agents" })}
					placeholder={t({ message: "Filter agents…" })}
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
				/>
				<Button
					variant="ghost"
					size="sm"
					className="w-full justify-start"
					onClick={() => setCreating(true)}
				>
					<Trans>Add agent</Trans>
				</Button>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						aria-label={t({ message: "Move agent up" })}
						disabled={
							reorder.isPending ||
							!selectedConfig ||
							visibleRows[0]?.id === selectedConfig.id
						}
						onClick={() => reorder.mutate(-1)}
					>
						<ArrowUp className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t({ message: "Move agent down" })}
						disabled={
							reorder.isPending ||
							!selectedConfig ||
							visibleRows.at(-1)?.id === selectedConfig.id
						}
						onClick={() => reorder.mutate(1)}
					>
						<ArrowDown className="size-3.5" />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={reset.isPending}
						onClick={() => setResetOpen(true)}
					>
						<Trans>Reset all</Trans>
					</Button>
				</div>
				<div className="space-y-1">
					{visibleRows.map((config) => (
						<button
							type="button"
							key={config.id}
							className={`flex items-center gap-2 w-full rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted ${!creating && selectedConfig?.id === config.id ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
							onClick={() => {
								setSelected(config.id);
								setCreating(false);
							}}
						>
							<AgentIcon
								presetId={config.presetId}
								iconId={config.iconId}
								className="size-4"
							/>
							{config.label}
						</button>
					))}
				</div>
			</aside>
			<div className="flex-1 min-w-0 p-6 lg:p-10">
				{configs.isPending && (
					<output className="text-sm text-muted-foreground">
						<Trans>Loading agents…</Trans>
					</output>
				)}
				{(reorder.error || reset.error) && (
					<p role="alert" className="text-xs text-destructive">
						{errorMessage(reorder.error ?? reset.error)}
					</p>
				)}
				{configs.error && (
					<div role="alert" className="text-sm text-destructive">
						{errorMessage(configs.error)}
						<Button variant="ghost" onClick={() => void configs.refetch()}>
							<Trans>Retry</Trans>
						</Button>
					</div>
				)}
				{(creating || selectedConfig) && (
					<AgentConfigEditor
						key={creating ? "new" : selectedConfig?.id}
						client={client}
						hostUrl={hostUrl}
						local={!remote}
						config={creating ? null : (selectedConfig ?? null)}
						onCreated={(id) => {
							setSelected(id);
							setCreating(false);
						}}
						onDeleted={() => {
							setSelected(null);
							setCreating(false);
						}}
					/>
				)}
			</div>
			<AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Reset all agent commands?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>
								This removes custom agents and replaces all launch
								configurations with the four bundled defaults. Existing sessions
								keep running. This cannot be undone.
							</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction onClick={() => reset.mutate()}>
							<Trans>Reset all</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
