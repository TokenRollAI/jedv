import { Button } from "@jedv/ui/button";
import { Checkbox } from "@jedv/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Input } from "@jedv/ui/input";
import { Label } from "@jedv/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@jedv/ui/tabs";
import { Trans, useLingui } from "@lingui/react/macro";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import type { Project } from "../../types";
import { supportsWorktrees } from "../../vcs-capabilities";
import type { ProjectActionContext } from "../JedvProjectActions";
import { redactProjectError } from "../JedvProjectActions/project-utils";
import { CompareBaseBranchPicker } from "./components/CompareBaseBranchPicker";
import { PullRequestPicker } from "./components/PullRequestPicker";
import type {
	BranchFilter,
	CreatedWorkspaceResult,
	CreateWorkspaceInput,
	WorkspaceCreateMode,
} from "./types";

export type { CreatedWorkspaceResult, CreateWorkspaceInput } from "./types";
export interface CreateWorkspaceDialogProps {
	context: ProjectActionContext;
	projects: (Pick<Project, "id" | "name"> &
		Partial<Pick<Project, "vcsKind" | "capabilities">>)[];
	initialProjectId?: string;
	initialMode?: WorkspaceCreateMode;
	initialBranch?: string;
	initialWorktreePath?: string;
	onRefresh(context: ProjectActionContext): Promise<void>;
	onCreated(result: CreatedWorkspaceResult): Promise<void> | void;
	onClose(): void;
}
export function CreateWorkspaceDialog(props: CreateWorkspaceDialogProps) {
	const { t } = useLingui();
	const id = useId();
	const [context] = useState(() => ({ ...props.context }));
	const [projectId, setProjectId] = useState(
		props.initialProjectId ?? props.projects[0]?.id ?? "",
	);
	const [requestedMode, setMode] = useState<WorkspaceCreateMode>(
		props.initialMode ?? "new",
	);
	const project = props.projects.find((project) => project.id === projectId);
	const gitEnabled = supportsWorktrees(project);
	const mode = gitEnabled ? requestedMode : "local";
	const [name, setName] = useState("");
	const [branch, setBranch] = useState(props.initialBranch ?? "");
	const [conflictFromServer, setConflictFromServer] = useState(false);
	const [baseBranch, setBaseBranch] = useState<string | null>(null);
	const [pr, setPr] = useState<number | null>(null);
	const [worktreePath, setWorktreePath] = useState(
		props.initialWorktreePath ?? "",
	);
	const [runSetup, setRunSetup] = useState(
		props.initialMode !== "import" && props.initialMode !== "local",
	);
	const [setupTouched, setSetupTouched] = useState(false);
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<BranchFilter>("all");
	const [pending, setPending] = useState(false);
	const busy = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<CreatedWorkspaceResult | null>(null);
	const attempt = useRef<{ signature: string; id: string } | null>(null);
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
		enabled: !!projectId && (mode === "new" || mode === "branch"),
		retry: false,
	});
	const worktrees = useQuery({
		queryKey: [
			"jedv",
			context.hostUrl,
			"workspace-create-worktrees",
			projectId,
		],
		queryFn: () =>
			context.client.workspaceCreation.listProjectWorktrees.query({
				projectId,
			}),
		enabled:
			!!projectId && (mode === "import" || mode === "new" || mode === "branch"),
		retry: false,
	});
	const branchWorktree = worktrees.data?.worktrees.find(
		(row) => row.branch === branch.trim(),
	);
	const sharedConflict =
		(mode === "new" || mode === "branch") &&
		(!!branchWorktree?.isMainWorktree || conflictFromServer);
	const existingConflict =
		mode === "new" &&
		!!branch.trim() &&
		!sharedConflict &&
		(!!branchWorktree ||
			!!branches.data?.pages.some((page) =>
				page.items.some((row) => row.name === branch.trim() && row.isLocal),
			));
	const branchConflict = sharedConflict || existingConflict;
	const switchToLocal = () => {
		setMode("local");
		setError(null);
		setConflictFromServer(false);
		if (!setupTouched) setRunSetup(false);
	};
	const submit = async () => {
		if (busy.current || !projectId || (!saved && branchConflict)) return;
		if (
			(mode === "branch" && !branch.trim()) ||
			(mode === "pr" && (!pr || !Number.isSafeInteger(pr))) ||
			(mode === "import" && !worktreePath)
		)
			return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			let result = saved;
			if (!result) {
				const input: CreateWorkspaceInput = {
					projectId,
					trackSetupCompletion: true,
					...(name.trim() ? { name: name.trim() } : {}),
					checkout: mode === "local" ? "local" : "worktree",
					runSetup: mode === "local" ? false : runSetup,
				};
				if (mode === "new") {
					if (branch.trim()) input.branch = branch.trim();
					const effectiveBase =
						baseBranch ?? branches.data?.pages[0]?.defaultBranch;
					if (effectiveBase) input.baseBranch = effectiveBase;
				}
				if (mode === "branch") {
					input.branch = branch.trim();
					input.skipBranchPrefix = true;
					if (worktreePath) input.worktreePath = worktreePath;
				}
				if (mode === "pr") input.pr = pr ?? undefined;
				if (mode === "import") {
					input.worktreePath = worktreePath;
					input.branch = worktrees.data?.worktrees.find(
						(row) => row.path === worktreePath,
					)?.branch;
					input.skipBranchPrefix = true;
				}
				const signature = JSON.stringify(input);
				if (attempt.current?.signature !== signature)
					attempt.current = { signature, id: crypto.randomUUID() };
				input.id = attempt.current.id;
				const created = await context.client.workspaces.create.mutate(input);
				result = {
					context,
					workspaceId: created.workspace.id,
					terminalId: created.terminals[0]?.terminalId,
				};
				setSaved(result);
			}
			await props.onRefresh(context);
			await props.onCreated(result);
			props.onClose();
		} catch (failure) {
			if (
				failure instanceof Error &&
				failure.message.includes("shared checkout")
			) {
				setConflictFromServer(true);
				setError(null);
			} else
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
	return (
		<Dialog
			open
			modal
			onOpenChange={(open) => {
				if (!open && !busy.current) props.onClose();
			}}
		>
			<DialogContent
				className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
				showCloseButton={!pending}
				onInteractOutside={(event) => {
					if (pending) event.preventDefault();
				}}
				onEscapeKeyDown={(event) => {
					if (pending) event.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						<Trans>New workspace</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Choose a checkout, branch, pull request, or existing worktree on
							the target host.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<p className="break-all text-xs text-muted-foreground">
					<Trans>Target host: {context.hostLabel}</Trans>
				</p>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-project`}>
							<Trans>Project</Trans>
						</Label>
						<Select
							value={projectId}
							disabled={pending || !!saved}
							onValueChange={(value) => {
								setProjectId(value);
								setConflictFromServer(false);
								setError(null);
								setBaseBranch(null);
								setBranch("");
								setPr(null);
								setWorktreePath("");
								attempt.current = null;
							}}
						>
							<SelectTrigger id={`${id}-project`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{props.projects.map((project) => (
									<SelectItem key={project.id} value={project.id}>
										{project.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<Tabs
						value={mode}
						onValueChange={(value) => {
							setMode(value as WorkspaceCreateMode);
							setConflictFromServer(false);
							if (!setupTouched)
								setRunSetup(value !== "import" && value !== "local");
							setError(null);
						}}
					>
						<TabsList className="grid h-auto w-full grid-cols-3 gap-1">
							<TabsTrigger
								disabled={!gitEnabled || pending || !!saved}
								value="new"
							>
								<Trans>New branch</Trans>
							</TabsTrigger>
							<TabsTrigger disabled={pending || !!saved} value="local">
								{gitEnabled ? (
									<Trans>Local checkout</Trans>
								) : (
									<Trans>Plain folder</Trans>
								)}
							</TabsTrigger>
							<TabsTrigger
								disabled={!gitEnabled || pending || !!saved}
								value="branch"
							>
								<Trans>Existing branch</Trans>
							</TabsTrigger>
							<TabsTrigger
								disabled={!gitEnabled || pending || !!saved}
								value="pr"
							>
								<Trans>Pull request</Trans>
							</TabsTrigger>
							<TabsTrigger
								disabled={!gitEnabled || pending || !!saved}
								value="import"
							>
								<Trans>Import worktree</Trans>
							</TabsTrigger>
						</TabsList>
					</Tabs>
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-name`}>
							<Trans>Workspace name</Trans>
						</Label>
						<Input
							id={`${id}-name`}
							value={name}
							disabled={pending || !!saved}
							onChange={(event) => setName(event.target.value)}
							placeholder={t({ message: "Automatic name" })}
						/>
					</div>
					{(mode === "new" || mode === "branch") && (
						<div className="space-y-2">
							<Label htmlFor={`${id}-branch`}>
								{mode === "new" ? (
									<Trans>New branch name</Trans>
								) : (
									<Trans>Existing branch</Trans>
								)}
							</Label>
							<Input
								id={`${id}-branch`}
								aria-invalid={branchConflict}
								aria-describedby={`${id}-branch-help`}
								value={branch}
								disabled={pending || !!saved}
								onChange={(event) => {
									setBranch(event.target.value);
									setConflictFromServer(false);
									setError(null);
									setWorktreePath("");
								}}
								placeholder={
									mode === "new"
										? t({ message: "Leave empty for a unique new branch" })
										: t({ message: "Branch name" })
								}
							/>
							<div id={`${id}-branch-help`} className="text-xs leading-5">
								{branchConflict ? (
									<div role="alert" className="space-y-2 text-destructive">
										<p>
											{sharedConflict ? (
												<Trans>
													This branch is used by the shared checkout. Choose a
													new name or use the local checkout.
												</Trans>
											) : (
												<Trans>
													This branch already exists. Choose a new name or
													select Existing branch.
												</Trans>
											)}
										</p>
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={pending || !!saved}
											onClick={
												sharedConflict
													? switchToLocal
													: () => {
															setMode("branch");
															setError(null);
														}
											}
										>
											{sharedConflict ? (
												<Trans>Use local checkout</Trans>
											) : (
												<Trans>Use existing branch</Trans>
											)}
										</Button>
									</div>
								) : (
									mode === "new" && (
										<p className="text-muted-foreground">
											<Trans>
												A new branch is separate from its base. Leave the name
												empty to generate a unique branch automatically.
											</Trans>
										</p>
									)
								)}
							</div>
							{mode === "new" && (
								<p className="text-xs font-medium">
									<Trans>Base branch to create from</Trans>
								</p>
							)}
							<CompareBaseBranchPicker
								effectiveCompareBaseBranch={
									mode === "new"
										? (baseBranch ??
											branches.data?.pages[0]?.defaultBranch ??
											null)
										: branch || null
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
								onSelectCompareBaseBranch={(value, source) => {
									if (mode === "new")
										setBaseBranch(
											source === "remote-tracking" ? `origin/${value}` : value,
										);
									else setBranch(value);
								}}
								onOpenWorkspace={(target) => {
									setMode("branch");
									setBranch(target.branchName);
									setWorktreePath(target.worktreePath ?? "");
								}}
							/>
						</div>
					)}
					{mode === "local" && (
						<p className="rounded border p-3 text-xs text-muted-foreground">
							{gitEnabled ? (
								<Trans>
									This workspace shares the project's files, index, and current
									branch. It does not switch branches or run setup.
								</Trans>
							) : (
								<Trans>
									Git features are unavailable here. Terminals and files remain
									available.
								</Trans>
							)}
						</p>
					)}
					{mode === "pr" && (
						<div className="space-y-2">
							<Label htmlFor={`${id}-pr`}>
								<Trans>Pull request number</Trans>
							</Label>
							<Input
								id={`${id}-pr`}
								type="number"
								min={1}
								disabled={pending || !!saved}
								value={pr ?? ""}
								onChange={(event) => setPr(Number(event.target.value) || null)}
							/>
							<PullRequestPicker
								context={context}
								projectId={projectId}
								value={pr}
								disabled={pending || !!saved}
								onSelect={setPr}
							/>
						</div>
					)}
					{mode === "import" && (
						<div className="space-y-2">
							{worktrees.isPending ? (
								<output className="text-xs">
									<Trans>Loading worktrees…</Trans>
								</output>
							) : worktrees.isError ? (
								<div role="alert" className="text-xs">
									<Trans>Could not read worktrees from the target host.</Trans>
									<Button
										type="button"
										variant="ghost"
										onClick={() => void worktrees.refetch()}
									>
										<Trans>Retry</Trans>
									</Button>
								</div>
							) : (
								<Select
									value={worktreePath}
									disabled={pending || !!saved}
									onValueChange={setWorktreePath}
								>
									<SelectTrigger
										aria-label={t({ message: "Existing worktree" })}
									>
										<SelectValue
											placeholder={t({ message: "Select worktree…" })}
										/>
									</SelectTrigger>
									<SelectContent>
										{worktrees.data?.worktrees
											.filter((row) => !row.isMainWorktree)
											.map((row) => (
												<SelectItem key={row.path} value={row.path}>
													<span className="flex flex-col">
														<span>
															{row.branch}
															{row.hasWorkspace && (
																<>
																	{" "}
																	· <Trans>Already open</Trans>
																</>
															)}
														</span>
														<span className="font-mono text-[10px]">
															{row.path}
														</span>
													</span>
												</SelectItem>
											))}
									</SelectContent>
								</Select>
							)}
							{worktrees.data?.worktrees.filter((row) => !row.isMainWorktree)
								.length === 0 && (
								<p className="text-xs text-muted-foreground">
									<Trans>No existing worktrees found.</Trans>
								</p>
							)}
						</div>
					)}
					{mode !== "local" && (
						<label
							htmlFor={`${id}-setup`}
							className="flex items-center gap-2 text-xs"
						>
							<Checkbox
								id={`${id}-setup`}
								checked={runSetup}
								disabled={pending || !!saved}
								onCheckedChange={(value) => {
									setRunSetup(value === true);
									setSetupTouched(true);
								}}
							/>
							<Trans>Run setup script</Trans>
						</label>
					)}
					{saved && (
						<p className="text-xs text-muted-foreground">
							<Trans>
								The workspace is saved. Continue opening it without creating
								another workspace.
							</Trans>
						</p>
					)}
					{error && (
						<p role="alert" className="break-words text-xs text-destructive">
							{error}
						</p>
					)}
					{pending && (
						<output className="text-xs text-muted-foreground">
							<Trans>Preparing workspace on the target host…</Trans>
						</output>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							disabled={pending}
							onClick={props.onClose}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button
							type="submit"
							disabled={
								pending ||
								(!saved && branchConflict) ||
								!projectId ||
								(mode === "branch" && !branch.trim()) ||
								(mode === "pr" && !pr) ||
								(mode === "import" && !worktreePath)
							}
						>
							{pending ? (
								<Trans>Creating…</Trans>
							) : saved ? (
								<Trans>Continue opening</Trans>
							) : (
								<Trans>Create workspace</Trans>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
