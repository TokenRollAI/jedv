import type { HostAgentConfig } from "@jedv/host-service/settings";
import { errorMessage } from "@jedv/i18n/errors";
import type { TerminalPreset } from "@jedv/local-db/schema/zod";
import { Button } from "@jedv/ui/button";
import { Checkbox } from "@jedv/ui/checkbox";
import { Input } from "@jedv/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Textarea } from "@jedv/ui/textarea";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { getAgentCommandText } from "renderer/lib/agent-launch-command";
import { resolvePresetAgentLink } from "renderer/lib/linked-terminal-presets";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { Project } from "../../../../../../types";

export function PresetEditor({
	preset,
	projects,
	agents,
	agentsPending,
	readPresets,
	loadAgents,
	onSaved,
	onCancel,
}: {
	preset: TerminalPreset | null;
	projects: Project[];
	agents: HostAgentConfig[];
	agentsPending: boolean;
	readPresets(): Promise<TerminalPreset[]>;
	loadAgents(): Promise<HostAgentConfig[]>;
	onSaved(): Promise<void>;
	onCancel(): void;
}) {
	const { t } = useLingui();
	const savedId = useRef(preset?.id ?? null);
	const [agentId, setAgentId] = useState(preset?.agentId ?? "");
	const link = resolvePresetAgentLink({ agentId }, agents, { remote: false });
	const [name, setName] = useState(preset?.name ?? "");
	const [description, setDescription] = useState(preset?.description ?? "");
	const [cwd, setCwd] = useState(preset?.cwd ?? "");
	const [commands, setCommands] = useState(
		(preset?.commands.length ? preset.commands : [""]).map((text) => ({
			id: crypto.randomUUID(),
			text,
		})),
	);
	const visibleCommands =
		link.status === "linked"
			? [{ id: "linked-agent-command", text: getAgentCommandText(link.agent) }]
			: commands;
	const clearAgentLink = () => {
		if (link.status === "linked")
			setCommands([
				{ id: crypto.randomUUID(), text: getAgentCommandText(link.agent) },
			]);
		setAgentId("");
	};
	const [pinnedToBar, setPinnedToBar] = useState(preset?.pinnedToBar ?? true);
	const [projectIds, setProjectIds] = useState<string[] | null>(
		preset?.projectIds ?? null,
	);
	const [executionMode, setExecutionMode] = useState<
		NonNullable<TerminalPreset["executionMode"]>
	>(preset?.executionMode ?? "new-tab");
	const save = useMutation({
		mutationFn: async () => {
			const currentLink = agentId
				? resolvePresetAgentLink({ agentId }, await loadAgents(), {
						remote: false,
					})
				: { status: "unlinked" as const };
			if (currentLink.status !== "unlinked" && currentLink.status !== "linked")
				throw new Error(t({ message: "Agent configuration unavailable" }));
			const linkedAgent =
				currentLink.status === "linked" ? currentLink.agent : null;
			const patch = {
				agentId: linkedAgent?.id ?? null,
				name: name.trim(),
				description,
				cwd: cwd.trim(),
				commands: linkedAgent
					? [getAgentCommandText(linkedAgent)]
					: commands
							.map((command) => command.text)
							.filter((command) => command.trim()),
				projectIds,
				pinnedToBar,
				executionMode,
			};
			if (savedId.current) {
				await electronTrpcClient.settings.updateTerminalPreset.mutate({
					id: savedId.current,
					patch,
				});
			} else {
				const created =
					await electronTrpcClient.settings.createTerminalPreset.mutate(patch);
				savedId.current = created.id;
			}
			const persisted = (await readPresets()).find(
				(row) => row.id === savedId.current,
			);
			if (!persisted || (persisted.agentId ?? null) !== patch.agentId)
				throw new Error(
					t({
						message:
							"Preset association could not be confirmed. Refresh and try again.",
					}),
				);
		},
		onSuccess: onSaved,
	});
	return (
		<form
			className="space-y-4 rounded-lg border border-border p-4"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			<div className="space-y-2">
				<label className="text-xs font-medium" htmlFor="preset-agent">
					<Trans>Linked agent</Trans>
				</label>
				<Select
					value={link.status === "linked" ? link.agent.id : agentId || "none"}
					disabled={save.isPending}
					onValueChange={(value) => {
						const next = value === "none" ? "" : value;
						if (!next) {
							clearAgentLink();
							return;
						}
						setAgentId(next);
						const selected = resolvePresetAgentLink({ agentId: next }, agents, {
							remote: false,
						});
						if (selected.status === "linked")
							setCommands([
								{
									id: crypto.randomUUID(),
									text: getAgentCommandText(selected.agent),
								},
							]);
					}}
				>
					<SelectTrigger id="preset-agent">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="none">
							<Trans>None</Trans>
						</SelectItem>
						{agentId && link.status !== "linked" && (
							<SelectItem value={agentId} disabled>
								<Trans>Agent configuration unavailable</Trans>
							</SelectItem>
						)}
						{agents.map((agent) => (
							<SelectItem key={agent.id} value={agent.id}>
								{agent.label} · {agent.id.slice(0, 8)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-xs text-muted-foreground">
					<Trans>Only agents on this device can be linked.</Trans>
				</p>
				{agentsPending && (
					<p className="text-xs text-muted-foreground">
						<Trans>Loading…</Trans>
					</p>
				)}
				{agentId && link.status !== "linked" && !agentsPending && (
					<p role="alert" className="text-xs text-destructive">
						{link.status === "ambiguous" ? (
							<Trans>More than one agent matches this preset.</Trans>
						) : (
							<Trans>Linked agent is unavailable.</Trans>
						)}
					</p>
				)}
				{agentId && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={save.isPending}
						onClick={clearAgentLink}
					>
						<Trans>Remove agent link</Trans>
					</Button>
				)}
			</div>
			<div className="space-y-1">
				<label className="text-xs font-medium" htmlFor="preset-name">
					<Trans>Name</Trans>
				</label>
				<Input
					id="preset-name"
					value={name}
					disabled={save.isPending}
					onChange={(event) => setName(event.target.value)}
				/>
			</div>
			<div className="space-y-1">
				<label className="text-xs font-medium" htmlFor="preset-description">
					<Trans>Description</Trans>
				</label>
				<Input
					id="preset-description"
					value={description}
					disabled={save.isPending}
					onChange={(event) => setDescription(event.target.value)}
				/>
			</div>
			<div className="space-y-1">
				<label className="text-xs font-medium" htmlFor="preset-cwd">
					<Trans>Working directory</Trans>
				</label>
				<Input
					id="preset-cwd"
					value={cwd}
					disabled={save.isPending}
					onChange={(event) => setCwd(event.target.value)}
				/>
				<p className="text-xs text-muted-foreground">
					<Trans>
						Leave empty to use the workspace directory. Relative paths are
						resolved inside the workspace.
					</Trans>
				</p>
			</div>
			<div className="space-y-2">
				<p className="text-xs font-medium">
					<Trans>Commands</Trans>
				</p>
				{link.status === "linked" && (
					<p className="text-xs text-muted-foreground">
						<Trans>Commands follow the linked agent.</Trans>
					</p>
				)}
				{visibleCommands.map((command, index) => (
					<div className="flex items-start gap-2" key={command.id}>
						<Textarea
							className="font-mono text-xs"
							aria-label={t({ message: `Command ${index + 1}` })}
							value={command.text}
							disabled={save.isPending || !!agentId}
							onChange={(event) =>
								setCommands(
									commands.map((value, at) =>
										at === index
											? { ...value, text: event.target.value }
											: value,
									),
								)
							}
						/>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={save.isPending || !!agentId || commands.length === 1}
							onClick={() =>
								setCommands(commands.filter((_, at) => at !== index))
							}
						>
							<Trans>Remove</Trans>
						</Button>
					</div>
				))}
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={save.isPending || !!agentId}
					onClick={() =>
						setCommands([...commands, { id: crypto.randomUUID(), text: "" }])
					}
				>
					<Trans>Add command</Trans>
				</Button>
			</div>
			<div className="space-y-2">
				<p className="text-xs font-medium">
					<Trans>Execution mode</Trans>
				</p>
				<Select
					value={executionMode}
					disabled={save.isPending}
					onValueChange={(value) =>
						setExecutionMode(value as typeof executionMode)
					}
				>
					<SelectTrigger aria-label={t({ message: "Execution mode" })}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="new-tab">
							<Trans>New tabs</Trans>
						</SelectItem>
						<SelectItem value="split-pane">
							<Trans>Split panes</Trans>
						</SelectItem>
						<SelectItem value="new-tab-split-pane">
							<Trans>New tab with split panes</Trans>
						</SelectItem>
						<SelectItem value="sequential">
							<Trans>Sequential commands in one terminal</Trans>
						</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div className="flex items-center gap-2">
				<Checkbox
					id="preset-pinned"
					checked={pinnedToBar}
					disabled={save.isPending}
					onCheckedChange={(checked) => setPinnedToBar(checked === true)}
				/>
				<label htmlFor="preset-pinned" className="text-xs">
					<Trans>Show in workspace launcher</Trans>
				</label>
			</div>
			<fieldset className="space-y-2">
				<legend className="text-xs font-medium">
					<Trans>Projects</Trans>
				</legend>
				<label
					htmlFor="preset-all-projects"
					className="flex items-center gap-2 text-xs"
				>
					<Checkbox
						id="preset-all-projects"
						checked={projectIds === null}
						disabled={save.isPending}
						onCheckedChange={(checked) => setProjectIds(checked ? null : [])}
					/>
					<Trans>All projects</Trans>
				</label>
				{projectIds !== null &&
					projects.map((project) => (
						<label
							htmlFor={`preset-project-${project.id}`}
							className="flex items-center gap-2 text-xs"
							key={project.id}
						>
							<Checkbox
								id={`preset-project-${project.id}`}
								disabled={save.isPending}
								checked={projectIds.includes(project.id)}
								onCheckedChange={(checked) =>
									setProjectIds(
										checked
											? [...projectIds, project.id]
											: projectIds.filter((id) => id !== project.id),
									)
								}
							/>
							{project.name}
						</label>
					))}
			</fieldset>
			{save.error && (
				<p role="alert" className="text-xs text-destructive">
					{errorMessage(save.error)}
				</p>
			)}
			<div className="flex items-center gap-2">
				<Button
					type="submit"
					size="sm"
					disabled={
						save.isPending ||
						(!!agentId && link.status !== "linked") ||
						!name.trim() ||
						(link.status !== "linked" &&
							!commands.some((command) => command.text.trim())) ||
						(projectIds !== null && projectIds.length === 0)
					}
				>
					{save.isPending ? <Trans>Saving…</Trans> : <Trans>Save preset</Trans>}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					disabled={save.isPending}
					onClick={onCancel}
				>
					<Trans>Cancel</Trans>
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				<Trans>Saving a preset does not run its commands.</Trans>
			</p>
		</form>
	);
}
