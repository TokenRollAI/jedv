import { errorMessage } from "@jedv/i18n/errors";
import { getPresetById } from "@jedv/shared/host-agent-presets";
import type { TeamStartInput } from "@jedv/shared/teamwork";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	usePromptInputController,
} from "@jedv/ui/ai-elements/prompt-input";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { useId, useRef, useState } from "react";
import {
	LuArrowRight,
	LuArrowUp,
	LuLink,
	LuPlus,
	LuRefreshCw,
} from "react-icons/lu";
import { teamworkKey } from "../../../../hooks/useTeamwork";
import type { CreateTeamViewProps } from "../../CreateTeamView";
import { taskTeamName } from "../../task-name";
import { ExistingTeamSessionDialog } from "../ExistingTeamSessionDialog";
import { TaskAgentPicker } from "../TaskAgentPicker/TaskAgentPicker";
import {
	type TaskConfiguration,
	TaskOptions,
} from "../TaskOptions/TaskOptions";
import { TaskWorkspacePicker } from "../TaskWorkspacePicker/TaskWorkspacePicker";
export function TeamTaskComposer({
	context,
	index,
	connected,
	initialWorkspaceId,
	onCreated,
}: CreateTeamViewProps) {
	const { t } = useLingui();
	const teamNameId = useId();
	const { client, hostUrl } = context;
	const cache = useQueryClient();
	const controller = usePromptInputController();
	const derivedName = taskTeamName(controller.textInput.value);
	const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId ?? ""),
		[agentId, setAgentId] = useState("");
	const [options, setOptions] = useState<TaskConfiguration>({
		name: "",
		model: "",
		effort: "",
	});
	const [pending, setPending] = useState(false),
		[uncertain, setUncertain] = useState(false),
		[error, setError] = useState<string | null>(null),
		[existing, setExisting] = useState(false);
	const busy = useRef(false);
	const attempt = useRef<TeamStartInput | null>(null);
	const configs = useQuery({
		queryKey: ["jedv", hostUrl, "agent-configs"],
		queryFn: () => client.settings.agentConfigs.list.query(),
		enabled: connected && index.supported,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 30_000,
	});
	const agents = (configs.data ?? []).filter(
		(config) =>
			["codex", "claude", "agy", "kimi"].includes(config.presetId) ||
			getPresetById(config.presetId) === undefined,
	);
	const agent =
		agents.find((a) => a.id === agentId) ?? (!agentId ? agents[0] : undefined);
	const workspaces = context.workspaces.filter((w) => w.archivedAt == null);
	const workspace =
		workspaces.find((w) => w.id === workspaceId) ??
		(!workspaceId ? workspaces[0] : undefined);
	const capabilities = index.capabilities.data;
	const supported =
		index.supported &&
		!!capabilities &&
		capabilities.features?.start === true &&
		!index.capabilities.isError;
	const locked = pending || uncertain;
	const allowed =
		connected &&
		supported &&
		(uncertain
			? !!attempt.current
			: !!workspace && !!agent && configs.isSuccess && !configs.isError);
	return (
		<div className="mx-auto max-w-3xl space-y-5">
			<header className="space-y-2">
				<h2 className="text-xl font-semibold tracking-tight">
					<Trans>What should the team accomplish?</Trans>
				</h2>
				<p className="text-xs text-muted-foreground">
					<Trans>Describe a goal to start a new task.</Trans>
				</p>
			</header>
			<PromptInput
				maxFiles={0}
				onSubmitCapture={(event) => {
					if (busy.current || !allowed || !controller.textInput.value.trim()) {
						event.preventDefault();
						event.stopPropagation();
					}
				}}
				onSubmitStart={() => {
					busy.current = true;
					setPending(true);
					setError(null);
				}}
				onSubmitEnd={() => {
					busy.current = false;
					setPending(false);
				}}
				onSubmit={async ({ text }) => {
					const resolvedName = taskTeamName(text, options.name);
					const request =
						attempt.current ??
						(workspace && agent
							? {
									operationId: crypto.randomUUID(),
									workspaceId: workspace.id,
									agent: agent.id,
									prompt: text,
									leaderName: "leader",
									...(resolvedName ? { name: resolvedName } : {}),
									...(options.model ? { model: options.model } : {}),
									...(options.effort ? { effort: options.effort } : {}),
								}
							: null);
					if (!request) throw new Error("Task configuration is unavailable");
					attempt.current = request;
					try {
						const result = await client.team.start.mutate(request);
						await cache.invalidateQueries({ queryKey: teamworkKey(hostUrl) });
						await cache.invalidateQueries({
							queryKey: ["jedv", hostUrl, "terminals", request.workspaceId],
						});
						attempt.current = null;
						setUncertain(false);
						onCreated(result.team.id);
					} catch (cause) {
						const code =
							cause instanceof TRPCClientError ? cause.data?.code : undefined;
						const definitive =
							code === "BAD_REQUEST" ||
							code === "NOT_FOUND" ||
							code === "PRECONDITION_FAILED" ||
							code === "UNAUTHORIZED" ||
							code === "FORBIDDEN";
						if (definitive) attempt.current = null;
						setUncertain(!definitive);
						setError(
							errorMessage(
								cause,
								t({ message: "Request failed. Your draft has been kept." }),
							),
						);
						throw cause;
					}
				}}
				className="rounded-xl border border-border/80 bg-card/90 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-1 focus-within:ring-ring [&>[data-slot=input-group]]:h-auto [&>[data-slot=input-group]]:flex-col [&>[data-slot=input-group]]:items-stretch [&>[data-slot=input-group]]:rounded-xl [&>[data-slot=input-group]]:border-0 [&>[data-slot=input-group]]:bg-transparent [&>[data-slot=input-group]]:shadow-none"
			>
				<div className="flex w-full items-center gap-2.5 border-b border-border/60 px-3.5 py-2.5">
					<label
						htmlFor={teamNameId}
						className="shrink-0 text-[11px] font-medium text-muted-foreground"
					>
						<Trans>Team name</Trans>
					</label>
					<input
						id={teamNameId}
						type="text"
						value={options.name}
						maxLength={120}
						disabled={locked}
						placeholder={
							derivedName || t({ message: "Auto-derived from task (optional)" })
						}
						onChange={(e) =>
							setOptions((old) => ({ ...old, name: e.target.value }))
						}
						className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
					/>
				</div>
				<PromptInputBody>
					<PromptInputTextarea
						autoFocus
						aria-label={t({ message: "Task" })}
						placeholder={t({ message: "Describe the task…" })}
						disabled={locked}
						maxLength={32_000}
						className="min-h-36 resize-none px-3.5 py-3 text-sm"
					/>
				</PromptInputBody>
				<PromptInputFooter className="flex-wrap gap-2 px-3 pb-3 pt-1.5">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<TaskWorkspacePicker
							context={context}
							value={workspace?.id ?? workspaceId}
							disabled={locked || !connected}
							onChange={setWorkspaceId}
						/>
						<TaskAgentPicker
							agents={agents}
							value={agent?.id ?? agentId}
							disabled={locked || !connected || configs.isPending}
							onChange={(value) => {
								setAgentId(value);
								setOptions((old) => ({ ...old, model: "", effort: "" }));
							}}
						/>
						<TaskOptions
							presetId={agent?.presetId ?? ""}
							value={options}
							disabled={locked}
							onChange={setOptions}
						/>
					</div>
					<PromptInputSubmit
						size="sm"
						disabled={pending || !allowed || !controller.textInput.value.trim()}
						aria-label={t({ message: "Start task" })}
						title={t({ message: "Start task" })}
						className="ml-auto h-8 w-auto gap-2 rounded-lg px-4 text-xs font-medium shadow-2xs"
					>
						<Trans>Start task</Trans>
						<LuArrowUp className="size-3.5" />
					</PromptInputSubmit>
				</PromptInputFooter>
			</PromptInput>
			{connected &&
				index.capabilities.isSuccess &&
				!index.capabilities.isError &&
				!supported && (
					<p role="alert" className="text-xs text-muted-foreground">
						<Trans>
							This host cannot start team tasks. Update the host or use an
							existing session.
						</Trans>
					</p>
				)}
			{!connected && (
				<p role="alert" className="text-xs text-destructive">
					<Trans>
						Host offline. Team actions are unavailable until the connection is
						restored.
					</Trans>
				</p>
			)}
			{(configs.isError || index.capabilities.isError) && (
				<div
					role="alert"
					className="flex items-center gap-2 text-xs text-destructive"
				>
					<Trans>Could not load agents</Trans>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onClick={() => {
							void configs.refetch();
							void index.capabilities.refetch();
						}}
					>
						<LuRefreshCw className="size-3.5" />
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			{!workspaces.length && (
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={locked || !connected}
					onClick={() => context.onOpenCreateWorkspace()}
				>
					<LuPlus className="size-3.5" />
					<Trans>New Workspace</Trans>
				</Button>
			)}
			{error && (
				<p role="alert" className="break-words text-xs text-destructive">
					{error}
				</p>
			)}
			{uncertain && (
				<p role="alert" className="text-xs text-muted-foreground">
					<Trans>Outcome uncertain. Retry with the same task settings.</Trans>
				</p>
			)}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="-ml-2.5 h-8 gap-2 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-foreground"
				disabled={locked || !connected || !index.supported}
				onClick={() => setExisting(true)}
			>
				<LuLink className="size-3.5" />
				<Trans>Use an existing session</Trans>
				<LuArrowRight className="size-3.5" />
			</Button>
			{existing && (
				<ExistingTeamSessionDialog
					context={context}
					index={index}
					connected={connected}
					name={options.name}
					goal={controller.textInput.value}
					onCreated={onCreated}
					onClose={() => setExisting(false)}
				/>
			)}
		</div>
	);
}
