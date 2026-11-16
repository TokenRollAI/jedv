import {
	getAgentEfforts,
	getAgentModelSupport,
} from "@jedv/shared/agent-models";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	ArrowUp,
	Lightbulb,
	Loader2,
	Monitor,
	Settings2,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentIcon } from "renderer/components/AgentIcon";
import { useAgentLaunchPreferences } from "renderer/hooks/useAgentLaunchPreferences";
import type { LocalClient } from "../../local-client";
import { supportsWorktrees } from "../../vcs-capabilities";
import {
	CreateWorkspaceDialog,
	type CreateWorkspaceDialogProps,
} from "../CreateWorkspaceDialog";
import { CompareBaseBranchPicker } from "../CreateWorkspaceDialog/components/CompareBaseBranchPicker";
import type {
	BranchFilter,
	CreatedWorkspaceResult,
} from "../CreateWorkspaceDialog/types";
import { redactProjectError } from "../JedvProjectActions/project-utils";
import { JedvSelect } from "../JedvSelect";
import { WorkspaceMark } from "./components/WorkspaceMark";

type CreateInput = Parameters<LocalClient["workspaces"]["create"]["mutate"]>[0];
type CreateResult = Awaited<
	ReturnType<LocalClient["workspaces"]["create"]["mutate"]>
>;
export interface NewWorkspaceScreenProps extends CreateWorkspaceDialogProps {
	readWaitForSetup(): Promise<boolean>;
}

// Layout follows Paradev NewWorkspaceScreen (d31b92a), with the local Host
// contract and the existing manual checkout dialog kept as separate entry points.
export function NewWorkspaceScreen(props: NewWorkspaceScreenProps) {
	const { t } = useLingui();
	const [context] = useState(() => ({ ...props.context }));
	const [projectId, setProjectId] = useState(
		props.initialProjectId ?? props.projects[0]?.id ?? "",
	);
	const [checkout, setCheckout] = useState<"local" | "worktree">(
		props.initialMode === "local" ? "local" : "worktree",
	);
	const [prompt, setPrompt] = useState("");

	const [model, setModel] = useState("");
	const [effort, setEffort] = useState("");
	const [baseBranch, setBaseBranch] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<BranchFilter>("all");
	const [manual, setManual] = useState(false);
	const [manualTarget, setManualTarget] = useState<{
		branchName: string;
		worktreePath?: string;
	} | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<CreateResult | null>(null);
	const [attempt, setAttempt] = useState<CreateInput | null>(null);
	const busy = useRef(false);
	const editor = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		editor.current?.focus();
	}, []);
	const project = props.projects.find((item) => item.id === projectId);
	const effectiveCheckout = supportsWorktrees(project) ? checkout : "local";
	const agents = useQuery({
		queryKey: ["jedv", context.hostUrl, "agent-configs"],
		queryFn: () => context.client.settings.agentConfigs.list.query(),
		retry: false,
	});
	const { selectedAgent: selectedAgentId, setSelectedAgent: setAgentId } =
		useAgentLaunchPreferences({
			agentStorageKey: "lastSelectedV2WorkspaceCreateAgent",
			defaultAgent: agents.data?.[0]?.id ?? "none",
			fallbackAgent: agents.data?.[0]?.id ?? "none",
			validAgents: [...(agents.data ?? []).map((item) => item.id), "none"],
			agentsReady: agents.isSuccess,
		});
	const agent = agents.data?.find((item) => item.id === selectedAgentId);
	const models = getAgentModelSupport(agent?.presetId ?? "")?.models ?? [];
	const efforts = getAgentEfforts(agent?.presetId ?? "", model || undefined);
	const branches = useInfiniteQuery({
		queryKey: [
			"jedv",
			context.hostUrl,
			"workspace-create-branches",
			projectId,
			search,
			filter,
		],
		queryFn: ({ pageParam }) =>
			context.client.workspaceCreation.searchBranches.query({
				projectId,
				query: search,
				filter,
				cursor: pageParam,
				limit: 50,
			}),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		enabled: !!projectId && effectiveCheckout === "worktree",
		retry: false,
	});
	const locked = pending || !!attempt || !!saved;
	const openCreated = async (result: CreateResult) => {
		const launched = result.agents.find(
			(item) => item.ok && item.kind === "terminal",
		);
		const target: CreatedWorkspaceResult = {
			context,
			workspaceId: result.workspace.id,
			terminalId: launched?.ok
				? launched.sessionId
				: result.terminals[0]?.terminalId,
		};
		await props.onRefresh(context);
		await props.onCreated(target);
		props.onClose();
	};
	const submit = async () => {
		if (busy.current || !projectId) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			if (saved) {
				await openCreated(saved);
				return;
			}
			let input = attempt;
			if (!input) {
				if (
					agents.isPending ||
					agents.isError ||
					(selectedAgentId !== "none" && !agent)
				)
					throw new Error(t({ message: "Agent configuration unavailable" }));
				const wantAgent = !!agent && !!prompt.trim();
				const waitForSetupBeforeAgents = wantAgent
					? await props.readWaitForSetup()
					: false;
				input = {
					id: crypto.randomUUID(),
					projectId,
					checkout: effectiveCheckout,
					...(effectiveCheckout === "worktree"
						? {
								baseBranch:
									baseBranch ??
									branches.data?.pages[0]?.defaultBranch ??
									undefined,
							}
						: {}),
					...(wantAgent
						? {
								agents: [
									{
										agent: agent.id,
										prompt: prompt.trim(),
										surface: "terminal",
										model: model || undefined,
										effort: effort || undefined,
									},
								],
								waitForSetupBeforeAgents,
							}
						: { namingPrompt: prompt.trim() || undefined }),
				};
				// A transport failure leaves an immutable request for retry with the same ID.
				// Never replay an Agent separately when the create result was uncertain.
				setAttempt(input);
			}
			const result = await context.client.workspaces.create.mutate(input);
			setSaved(result);
			const failures = result.agents.filter((item) => !item.ok);
			if (
				failures.length ||
				(input.agents?.length && result.agents.length === 0)
			) {
				setError(
					[
						t({
							message:
								"Workspace created. Open it to check the agent before trying again.",
						}),
						...failures.flatMap((item) =>
							item.ok ? [] : [redactProjectError(item.error)],
						),
					].join(" "),
				);
				await props.onRefresh(context);
				return;
			}
			await openCreated(result);
		} catch (failure) {
			// Schema rejection is known to precede all creation effects.
			if (
				typeof failure === "object" &&
				failure !== null &&
				"data" in failure &&
				typeof failure.data === "object" &&
				failure.data !== null &&
				"code" in failure.data &&
				failure.data.code === "BAD_REQUEST"
			)
				setAttempt(null);
			setError(
				redactProjectError(
					failure instanceof Error
						? failure.message
						: t({
								message:
									"Could not create workspace. Check the target host and retry.",
							}),
				),
			);
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	const suggestions = [
		t({ message: "Improve agent instructions" }),
		t({ message: "Add tests where coverage is missing" }),
		t({ message: "Find and fix a bug" }),
	];
	const pill =
		"border-0 bg-transparent shadow-none text-muted-foreground hover:text-foreground w-auto max-w-44";
	return (
		<section
			aria-label={t({ message: "New workspace" })}
			className="absolute inset-0 z-40 flex flex-col items-center overflow-y-auto bg-background"
		>
			<div className="flex h-12 w-full shrink-0 items-center justify-end gap-1 px-3">
				<Button
					variant="ghost"
					size="icon"
					disabled={locked}
					onClick={() => {
						setManualTarget(null);
						setManual(true);
					}}
					title={t({ message: "Manual workspace creation" })}
					aria-label={t({ message: "Manual workspace creation" })}
				>
					<Settings2 className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					disabled={pending}
					onClick={props.onClose}
					aria-label={t({ message: "Close" })}
				>
					<X className="size-4" />
				</Button>
			</div>
			<div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-8 [@media(max-height:640px)]:hidden">
				<WorkspaceMark className="h-10 w-auto text-muted-foreground/70" />
				<h1 className="text-center text-3xl font-medium text-foreground/90">
					<Trans>What should we build next?</Trans>
				</h1>
			</div>
			<div className="flex w-full flex-1 flex-col items-center justify-end px-6 pb-8 pt-8">
				<div className="relative flex w-full max-w-[592px] flex-col">
					{!prompt && !saved && (
						<div className="mb-3 space-y-1">
							{suggestions.map((text) => (
								<button
									key={text}
									type="button"
									disabled={locked}
									onClick={() => {
										setPrompt(text);
										editor.current?.focus();
									}}
									className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									<Lightbulb className="size-4 shrink-0" />
									{text}
								</button>
							))}
						</div>
					)}
					{error && (
						<p
							role="alert"
							className="mb-3 rounded-md border border-destructive/30 bg-background p-3 text-sm text-destructive"
						>
							{error}
						</p>
					)}
					<form
						className="rounded-2xl bg-muted p-3"
						onSubmit={(event) => {
							event.preventDefault();
							void submit();
						}}
					>
						<textarea
							ref={editor}
							aria-label={t({ message: "What do you want to do?" })}
							placeholder={t({ message: "What do you want to do?" })}
							value={prompt}
							disabled={locked}
							onChange={(event) => setPrompt(event.target.value)}
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									!event.shiftKey &&
									!event.nativeEvent.isComposing &&
									!event.repeat
								) {
									event.preventDefault();
									void submit();
								}
							}}
							className="min-h-20 max-h-[max(5rem,calc(50vh-16rem))] w-full resize-y bg-transparent p-1 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-70"
						/>
						<div className="mt-2 flex flex-wrap items-center justify-end gap-1">
							{agent && (
								<AgentIcon
									presetId={agent.presetId}
									iconId={agent.iconId}
									className="size-4"
								/>
							)}
							<JedvSelect
								label={t({ message: "Agent" })}
								value={selectedAgentId}
								disabled={locked || agents.isPending}
								onValueChange={(value) => {
									setAgentId(value);
									setModel("");
									setEffort("");
								}}
								options={[
									...(agents.data ?? []).map((item) => ({
										value: item.id,
										label: item.label,
									})),
									{ value: "none", label: t({ message: "None" }) },
								]}
								className={pill}
							/>
							{!!models.length && (
								<JedvSelect
									label={t({ message: "Model" })}
									value={model}
									disabled={locked}
									onValueChange={(value) => {
										setModel(value);
										setEffort("");
									}}
									options={[
										{ value: "", label: t({ message: "Default" }) },
										...models.map((item) => ({
											value: item.id,
											label: item.label,
										})),
									]}
									className={pill}
								/>
							)}
							{!!efforts.length && (
								<JedvSelect
									label={t({ message: "Effort" })}
									value={effort}
									disabled={locked}
									onValueChange={setEffort}
									options={[
										{ value: "", label: t({ message: "Default" }) },
										...efforts.map((item) => ({
											value: item.id,
											label: item.label,
										})),
									]}
									className={pill}
								/>
							)}
							<Button
								type="submit"
								size={saved ? "sm" : "icon"}
								disabled={pending || !projectId || agents.isPending}
								className="ml-2 shrink-0 rounded-xl"
								aria-label={
									saved
										? t({ message: "Open workspace" })
										: t({ message: "Create workspace" })
								}
							>
								{pending ? (
									<Loader2 className="size-5 animate-spin" />
								) : saved ? (
									<Trans>Open workspace</Trans>
								) : (
									<ArrowUp className="size-5" />
								)}
							</Button>
						</div>
					</form>
					{pending && (
						<output className="mt-2 text-sm text-muted-foreground">
							<Trans>Creating workspace…</Trans>
						</output>
					)}
					<div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
						<span
							className="flex max-w-44 items-center gap-1.5 px-1"
							title={context.hostLabel}
						>
							<Monitor className="size-3.5 shrink-0" />
							<span className="truncate">{context.hostLabel}</span>
						</span>
						<JedvSelect
							label={t({ message: "Project" })}
							value={projectId}
							disabled={locked}
							onValueChange={(value) => {
								setProjectId(value);
								setBaseBranch(null);
								setSearch("");
							}}
							options={props.projects.map((item) => ({
								value: item.id,
								label: item.name,
							}))}
							className={pill}
						/>
						<JedvSelect
							label={t({ message: "Checkout" })}
							value={effectiveCheckout}
							disabled={locked || !supportsWorktrees(project)}
							onValueChange={(value) =>
								setCheckout(value as "local" | "worktree")
							}
							options={[
								{ value: "worktree", label: t({ message: "Worktree" }) },
								{ value: "local", label: t({ message: "Local checkout" }) },
							]}
							className={pill}
						/>
						{effectiveCheckout === "worktree" && (
							<fieldset
								disabled={locked}
								className="min-w-0 max-w-full border-0 p-0"
							>
								<CompareBaseBranchPicker
									effectiveCompareBaseBranch={
										baseBranch ?? branches.data?.pages[0]?.defaultBranch ?? null
									}
									defaultBranch={branches.data?.pages[0]?.defaultBranch}
									isBranchesLoading={branches.isPending}
									isBranchesError={branches.isError}
									branchesError={branches.error}
									isBranchesRefetching={branches.isRefetching}
									onRetryBranches={() => void branches.refetch()}
									isHostOffline={false}
									branches={
										branches.data?.pages.flatMap((page) => page.items) ?? []
									}
									branchSearch={search}
									onBranchSearchChange={setSearch}
									branchFilter={filter}
									onBranchFilterChange={setFilter}
									isFetchingNextPage={branches.isFetchingNextPage}
									hasNextPage={branches.hasNextPage}
									onLoadMore={() => void branches.fetchNextPage()}
									onSelectCompareBaseBranch={setBaseBranch}
									onOpenWorkspace={(target) => {
										setManualTarget(target);
										setManual(true);
									}}
								/>
							</fieldset>
						)}
					</div>
				</div>
			</div>
			{manual && (
				<CreateWorkspaceDialog
					{...props}
					initialProjectId={projectId}
					initialMode={manualTarget ? "branch" : props.initialMode}
					initialBranch={manualTarget?.branchName}
					initialWorktreePath={manualTarget?.worktreePath}
					onClose={() => setManual(false)}
					onCreated={async (result) => {
						await props.onCreated(result);
						props.onClose();
					}}
				/>
			)}
		</section>
	);
}
