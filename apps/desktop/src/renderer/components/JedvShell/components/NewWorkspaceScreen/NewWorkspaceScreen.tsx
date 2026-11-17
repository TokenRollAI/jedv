import {
	getAgentEfforts,
	getAgentModelSupport,
} from "@jedv/shared/agent-models";
import {
	MAX_ATTACHMENTS,
	MAX_INLINE_ATTACHMENT_BYTES,
} from "@jedv/shared/attachment-limits";
import { Button } from "@jedv/ui/button";
import { getClipboardFiles } from "@jedv/ui/lib/clipboard-files";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { cn } from "@jedv/ui/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	ArrowUp,
	Loader2,
	Monitor,
	Paperclip,
	Settings2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentIcon } from "renderer/components/AgentIcon";
import { useAgentLaunchPreferences } from "renderer/hooks/useAgentLaunchPreferences";
import type { LocalClient } from "../../local-client";
import {
	AttachmentReadError,
	createSafePreviewUrl,
	uploadHostAttachment,
} from "../../utils/upload-host-attachment";
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
	const [isDragOver, setIsDragOver] = useState(false);
	const [attachments, setAttachments] = useState<
		Array<{
			id: string;
			file: File;
			previewUrl: string | null;
			uploadedId?: string;
		}>
	>([]);
	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;
	const fileInputRef = useRef<HTMLInputElement>(null);
	const busy = useRef(false);
	const editor = useRef<HTMLTextAreaElement>(null);
	const { onClose } = props;
	useEffect(() => {
		editor.current?.focus();
	}, []);
	useEffect(
		() => () => {
			for (const item of attachmentsRef.current) {
				if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
			}
		},
		[],
	);
	const addAttachmentFiles = useCallback(
		(incoming: File[]) => {
			if (incoming.length === 0) return;
			setError(null);
			setAttachments((prev) => {
				const remaining = MAX_ATTACHMENTS - prev.length;
				if (remaining <= 0) {
					setError(
						t({
							message: `At most ${MAX_ATTACHMENTS} attachments can be added.`,
						}),
					);
					return prev;
				}
				const next = [...prev];
				for (const file of incoming.slice(0, remaining)) {
					if (file.size > MAX_INLINE_ATTACHMENT_BYTES) {
						setError(
							t({
								message: "Attachment is too large (maximum 10 MB).",
							}),
						);
						continue;
					}
					if (file.size === 0) continue;
					next.push({
						id: crypto.randomUUID(),
						file,
						previewUrl: createSafePreviewUrl(file),
					});
				}
				return next;
			});
		},
		[t],
	);
	const removeAttachment = useCallback((id: string) => {
		setAttachments((prev) => {
			const target = prev.find((item) => item.id === id);
			if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
			return prev.filter((item) => item.id !== id);
		});
	}, []);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.key !== "Escape" ||
				event.defaultPrevented ||
				event.altKey ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				pending ||
				manual
			)
				return;
			if (
				document.querySelector(
					'[role="listbox"], [role="dialog"], [role="menu"]',
				)
			)
				return;
			event.preventDefault();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [pending, manual, onClose]);
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
			const uploadedIds: string[] = [];
			if (attachmentsRef.current.length > 0) {
				const updated = [...attachmentsRef.current];
				for (let index = 0; index < updated.length; index++) {
					const item = updated[index];
					if (!item) continue;
					if (item.uploadedId) {
						uploadedIds.push(item.uploadedId);
						continue;
					}
					const uploaded = await uploadHostAttachment(
						context.client,
						item.file,
					);
					updated[index] = { ...item, uploadedId: uploaded.attachmentId };
					uploadedIds.push(uploaded.attachmentId);
				}
				attachmentsRef.current = updated;
				setAttachments(updated);
			}
			let input = attempt;
			if (!input) {
				if (
					agents.isPending ||
					agents.isError ||
					(selectedAgentId !== "none" && !agent)
				)
					throw new Error(t({ message: "Agent configuration unavailable" }));
				const wantAgent =
					!!agent && (!!prompt.trim() || uploadedIds.length > 0);
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
										...(uploadedIds.length > 0
											? { attachmentIds: uploadedIds }
											: {}),
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
			if (!input.agents?.length && uploadedIds.length > 0) {
				await context.client.attachments.materializeIntoWorkspace.mutate({
					workspaceId: result.workspace.id,
					attachmentIds: uploadedIds,
				});
			}
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
			if (failure instanceof AttachmentReadError) {
				setError(
					failure.reason === "too-large"
						? t({ message: "Attachment is too large (maximum 10 MB)." })
						: t({ message: "The attachment could not be read." }),
				);
				return;
			}
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
	const noAgentSelected = agents.isSuccess && selectedAgentId === "none";
	const promptLabel = noAgentSelected
		? t({ message: "Workspace or branch name (optional)" })
		: t({ message: "What do you want to do?" });
	const pill =
		"h-7.5 w-auto max-w-48 gap-1.5 rounded-lg border border-border/70 bg-secondary/55 px-3 text-xs font-medium text-muted-foreground shadow-none hover:border-border hover:bg-accent/60 hover:text-foreground";
	return (
		<section
			aria-label={t({ message: "New workspace" })}
			className="absolute inset-0 z-40 flex flex-col items-center overflow-y-auto bg-background"
		>
			<div className="flex h-10 w-full shrink-0 items-center justify-end gap-1 px-3">
				<Button
					variant="ghost"
					size="icon"
					className="size-7 rounded-md text-muted-foreground hover:text-foreground"
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
					className="size-7 rounded-md text-muted-foreground hover:text-foreground"
					disabled={pending}
					onClick={props.onClose}
					aria-label={t({ message: "Close" })}
				>
					<X className="size-4" />
				</Button>
			</div>
			<div className="flex w-full flex-1 flex-col items-center justify-center px-6 py-8">
				<div className="relative flex w-full max-w-[600px] flex-col items-center">
					<div className="mb-6 flex flex-col items-center gap-4">
						<WorkspaceMark className="h-9 w-auto text-muted-foreground/80" />
						<h1 className="text-center text-2xl font-medium tracking-tight text-foreground/95">
							<Trans>What should we build next?</Trans>
						</h1>
					</div>
					{error && (
						<p
							role="alert"
							className="mb-3 w-full rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
						>
							{error}
						</p>
					)}
					<form
						className={cn(
							"w-full rounded-xl border border-border/80 bg-card/90 p-3.5 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-1 focus-within:ring-ring",
							isDragOver && "border-ring ring-1 ring-ring",
						)}
						onDragOver={(event) => {
							if (locked) return;
							if (event.dataTransfer?.types?.includes("Files")) {
								event.preventDefault();
								setIsDragOver(true);
							}
						}}
						onDragLeave={(event) => {
							if (!event.currentTarget.contains(event.relatedTarget as Node)) {
								setIsDragOver(false);
							}
						}}
						onDrop={(event) => {
							setIsDragOver(false);
							if (locked) return;
							const files = getClipboardFiles(event.dataTransfer);
							if (files.length > 0) {
								event.preventDefault();
								addAttachmentFiles(files);
							}
						}}
						onSubmit={(event) => {
							event.preventDefault();
							void submit();
						}}
					>
						<input
							ref={fileInputRef}
							type="file"
							multiple
							hidden
							disabled={locked}
							onChange={(event) => {
								const files = Array.from(event.currentTarget.files ?? []);
								if (files.length > 0) addAttachmentFiles(files);
								event.currentTarget.value = "";
							}}
						/>
						{attachments.length > 0 && (
							<div className="mb-2.5 flex flex-wrap items-center gap-2">
								{attachments.map((item) => (
									<div
										key={item.id}
										className="group relative flex items-center gap-1.5 rounded-lg border border-border/70 bg-secondary/45 p-1 pr-2 text-xs text-foreground"
										title={item.file.name}
									>
										{item.previewUrl ? (
											<img
												src={item.previewUrl}
												alt={item.file.name}
												className="size-10 shrink-0 rounded-md object-cover"
											/>
										) : (
											<span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground">
												<Paperclip className="size-3.5" />
											</span>
										)}
										<span className="max-w-32 truncate text-[11px] text-muted-foreground">
											{item.file.name}
										</span>
										{!locked && (
											<button
												type="button"
												aria-label={t({ message: "Remove attachment" })}
												onClick={() => removeAttachment(item.id)}
												className="ml-0.5 grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
											>
												<X className="size-3" />
											</button>
										)}
									</div>
								))}
							</div>
						)}
						<textarea
							ref={editor}
							aria-label={promptLabel}
							placeholder={promptLabel}
							value={prompt}
							disabled={locked}
							onChange={(event) => setPrompt(event.target.value)}
							onPaste={(event) => {
								if (locked) return;
								const files = getClipboardFiles(event.clipboardData);
								if (files.length > 0) {
									event.preventDefault();
									addAttachmentFiles(files);
								}
							}}
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
							className="min-h-20 max-h-[max(5rem,calc(50vh-16rem))] w-full resize-none bg-transparent px-1 py-0.5 text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-70"
						/>
						<div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								disabled={locked || attachments.length >= MAX_ATTACHMENTS}
								aria-label={t({ message: "Attach files" })}
								title={t({ message: "Attach files" })}
								onClick={() => fileInputRef.current?.click()}
								className="mr-auto size-7 shrink-0 rounded-md text-muted-foreground hover:bg-fill-hover hover:text-foreground"
							>
								<Paperclip className="size-3.5" />
							</Button>
							{agent && (
								<AgentIcon
									presetId={agent.presetId}
									iconId={agent.iconId}
									className="size-4 shrink-0"
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
								<GroupedPrefixedSelect
									label={t({ message: "Model" })}
									prefix={t({ message: "Model:" })}
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
											group: item.group,
										})),
									]}
									className={pill}
								/>
							)}
							{!!efforts.length && (
								<GroupedPrefixedSelect
									label={t({ message: "Effort" })}
									prefix={t({ message: "Effort:" })}
									value={effort}
									disabled={locked}
									onValueChange={setEffort}
									options={[
										{ value: "", label: t({ message: "Default" }) },
										...efforts.map((item) => ({
											value: item.id,
											label: item.label,
											group: item.group,
										})),
									]}
									className={pill}
								/>
							)}
							<Button
								type="submit"
								size={saved ? "sm" : "icon"}
								disabled={pending || !projectId || agents.isPending}
								className={
									saved
										? "ml-1.5 h-8 shrink-0 rounded-lg px-3.5 text-xs font-medium"
										: "ml-1.5 size-8 shrink-0 rounded-full"
								}
								aria-label={
									saved
										? t({ message: "Open workspace" })
										: t({ message: "Create workspace" })
								}
							>
								{pending ? (
									<Loader2 className="size-4 animate-spin" />
								) : saved ? (
									<Trans>Open workspace</Trans>
								) : (
									<ArrowUp className="size-4" />
								)}
							</Button>
						</div>
					</form>
					{pending && (
						<output className="mt-2.5 text-xs text-muted-foreground">
							<Trans>Creating workspace…</Trans>
						</output>
					)}
					<div className="mt-3 flex w-full flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
						<span
							className="inline-flex h-7.5 max-w-48 items-center gap-1.5 rounded-lg border border-border/60 bg-card/45 px-3 font-medium"
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

interface GroupedSelectOption {
	value: string;
	label: string;
	group?: string;
}

function GroupedPrefixedSelect({
	value,
	options,
	onValueChange,
	label,
	prefix,
	disabled,
	className,
}: {
	value: string;
	options: GroupedSelectOption[];
	onValueChange(value: string): void;
	label: string;
	prefix: string;
	disabled?: boolean;
	className?: string;
}) {
	const selected = options.find((option) => option.value === value);
	const ungrouped = options.filter((option) => !option.group);
	const groups: { name: string; items: GroupedSelectOption[] }[] = [];
	for (const option of options) {
		if (!option.group) continue;
		let bucket = groups.find((entry) => entry.name === option.group);
		if (!bucket) {
			bucket = { name: option.group, items: [] };
			groups.push(bucket);
		}
		bucket.items.push(option);
	}
	return (
		<Select
			value={selected ? `value:${selected.value}` : ""}
			onValueChange={(encoded) => onValueChange(encoded.slice(6))}
			disabled={disabled}
		>
			<SelectTrigger
				aria-label={label}
				title={selected ? `${prefix} ${selected.label}` : label}
				className={cn(
					"data-[size=default]:h-auto min-h-7 min-w-0 max-w-full py-1 text-xs [&>span]:min-w-0 [&>span]:truncate",
					className,
				)}
			>
				<span className="flex min-w-0 items-center gap-1">
					<span className="shrink-0 text-muted-foreground/75">{prefix}</span>
					<SelectValue />
				</span>
			</SelectTrigger>
			<SelectContent
				position="popper"
				className="max-h-[min(20rem,var(--radix-select-content-available-height))] max-w-[min(28rem,calc(100vw-2rem))] overflow-y-auto"
			>
				{ungrouped.map((option) => (
					<SelectItem
						key={option.value}
						value={`value:${option.value}`}
						title={option.label}
						className="min-w-0 text-xs [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
					>
						<span className="block truncate">{option.label}</span>
					</SelectItem>
				))}
				{groups.map((group) => (
					<SelectGroup key={group.name}>
						<SelectLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
							{group.name}
						</SelectLabel>
						{group.items.map((option) => (
							<SelectItem
								key={option.value}
								value={`value:${option.value}`}
								title={option.label}
								className="min-w-0 text-xs [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
							>
								<span className="block truncate">{option.label}</span>
							</SelectItem>
						))}
					</SelectGroup>
				))}
			</SelectContent>
		</Select>
	);
}
