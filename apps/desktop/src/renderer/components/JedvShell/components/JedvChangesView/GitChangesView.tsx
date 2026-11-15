import { formatNumber } from "@jedv/i18n/format";
import { Button } from "@jedv/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronDown,
	GitBranch,
	Loader2,
	Minus,
	Plus,
	RefreshCw,
	Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { DiffViewMode } from "shared/changes-types";
import { detectLanguage } from "shared/detect-language";
import type { LocalClient } from "../../local-client";
import { LightDiffViewer } from "../JedvFilesView/components/LightDiffViewer";
import { assertWorkspaceFileTarget } from "../JedvFilesView/utils/workspace-file-client";
import { resolveWorkspaceFilePath } from "../JedvFilesView/utils/workspace-path";
import { ChangedFileFolderList } from "./components/ChangedFileFolderList";
import { ChangesDiffTabs, changeKey } from "./components/ChangesDiffTabs";
import { ChangesRow } from "./components/ChangesRow";
import { ChangesToolbar } from "./components/ChangesToolbar";
import { ChangesTree } from "./components/ChangesTree";
import { CommitForm } from "./components/CommitForm";
import { GitConfirmDialog } from "./components/GitConfirmDialog";
import { useFoldSignal } from "./hooks/useFoldSignal";
import type {
	Category,
	ChangedFile,
	ChangeSelection,
	ChangesFilter,
	ChangesViewMode,
} from "./types";

type PushPreview = Awaited<
	ReturnType<LocalClient["git"]["getPushPreview"]["query"]>
>;
type ReadyPreview = Extract<PushPreview, { status: "ready" }>;
type Confirmation =
	| {
			kind: "commit";
			branch: string;
			head: string;
			files: ChangedFile[];
			message: string;
	  }
	| { kind: "discard"; branch: string; file: ChangedFile }
	| { kind: "checkout"; branch: string; source: string }
	| { kind: "push"; preview: ReadyPreview };
const signature = (files: ChangedFile[]) =>
	JSON.stringify(
		files.map((file) => [file.path, file.oldPath, file.status]).sort(),
	);

export function GitChangesView({
	client,
	hostUrl,
	workspaceId,
	onOpenFile,
	active,
	getHasUnsavedFiles,
	remote = true,
	shipOnly,
}: {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string;
	active: boolean;
	onOpenFile(path: string, pinned?: boolean): void;
	getHasUnsavedFiles?: () => boolean;
	remote?: boolean;
	shipOnly?: "commit" | "push";
}) {
	const { t } = useLingui();
	const cache = useQueryClient();
	const workspace = useQuery({
		queryKey: ["jedv", hostUrl, "files-workspace", workspaceId],
		queryFn: () => client.workspace.get.query({ id: workspaceId }),
		enabled: active,
		retry: false,
	});
	const rootPath = workspace.data?.worktreePath;
	const openExternal = async (path: string) => {
		if (remote || !rootPath) return;
		const absolute = resolveWorkspaceFilePath(rootPath, path);
		if (!absolute) return;
		try {
			await assertWorkspaceFileTarget(client, workspaceId, rootPath, absolute);
			await electronTrpcClient.external.openFileInEditor.mutate({
				path: absolute,
				worktreePath: rootPath,
			});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};
	const statusKey = ["jedv", hostUrl, workspaceId, "git-status"];
	const status = useQuery({
		queryKey: statusKey,
		queryFn: () => client.git.getStatus.query({ workspaceId }),
		enabled: active,
		refetchInterval: active ? 10000 : false,
		retry: false,
	});
	const base = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "git-base"],
		queryFn: () => client.git.getBaseBranch.query({ workspaceId }),
		enabled: active,
		retry: false,
	});
	const branches = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "git-branches"],
		queryFn: () => client.git.listBranches.query({ workspaceId }),
		enabled: active,
		retry: false,
	});
	const sync = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "git-sync"],
		queryFn: () => client.git.getBranchSyncStatus.query({ workspaceId }),
		enabled: active,
		refetchInterval: active ? 10000 : false,
		retry: false,
	});
	const conflicts = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			workspaceId,
			"git-conflicts",
			status.dataUpdatedAt,
		],
		queryFn: () => client.git.getConflicts.query({ workspaceId }),
		enabled: active,
		retry: false,
	});
	const preview = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			workspaceId,
			"git-push-preview",
			status.dataUpdatedAt,
		],
		queryFn: () => client.git.getPushPreview.query({ workspaceId }),
		enabled: active,
		retry: false,
	});
	const commits = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			workspaceId,
			"git-commits",
			base.data?.baseBranch,
			status.data?.currentBranch.lastCommitHash,
		],
		queryFn: () =>
			client.git.listCommits.query({
				workspaceId,
				baseBranch: base.data?.baseBranch ?? undefined,
			}),
		enabled: active && !!status.data,
		retry: false,
	});
	const [selection, setSelection] = useState<ChangeSelection | null>(null);
	const [diffTabs, setDiffTabs] = useState<ChangeSelection[]>([]);
	const [view, setView] = useState<DiffViewMode>("side-by-side");
	const [mode, setMode] = useState<ChangesViewMode>("tree");
	const [filter, setFilter] = useState<ChangesFilter>({ kind: "all" });
	const [searchOpen, setSearchOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [message, setMessage] = useState("");
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [confirmError, setConfirmError] = useState<string | null>(null);
	const [pending, setPending] = useState(new Set<string>());
	const locks = useRef(new Set<string>());
	const [operation, setOperation] = useState<string | null>(null);
	const operationRef = useRef<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<string | null>(null);
	const [unknown, setUnknown] = useState(false);
	const [checked, setChecked] = useState(false);
	const { foldSignal, collapsed, toggleFold } = useFoldSignal();
	const commitHash =
		filter.kind === "commit"
			? filter.hash
			: filter.kind === "range"
				? filter.toHash
				: undefined;
	const fromHash = filter.kind === "range" ? filter.fromHash : undefined;
	const commitFiles = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			workspaceId,
			"git-commit-files",
			commitHash,
			fromHash,
		],
		queryFn: () =>
			client.git.getCommitFiles.query({
				workspaceId,
				commitHash: commitHash ?? "",
				fromHash,
			}),
		enabled: active && !!commitHash,
		retry: false,
	});
	const groups: { category: Category; label: string; files: ChangedFile[] }[] =
		commitHash
			? [
					{
						category: "commit",
						label: t({ message: "Commits" }),
						files: commitFiles.data?.files ?? [],
					},
				]
			: [
					{
						category: "unstaged",
						label: t({ message: "Unstaged" }),
						files: status.data?.unstaged ?? [],
					},
					{
						category: "staged",
						label: t({ message: "Staged" }),
						files: status.data?.staged ?? [],
					},
					...(filter.kind === "all"
						? [
								{
									category: "against-base" as const,
									label: t({ message: "Base branch" }),
									files: status.data?.againstBase ?? [],
								},
							]
						: []),
				];
	const selected = selection
		? groups
				.find((group) => group.category === selection.category)
				?.files.find((file) => file.path === selection.path)
		: undefined;
	const diff = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			workspaceId,
			"diff",
			selection?.category,
			selected?.path,
			selected?.oldPath,
			status.dataUpdatedAt,
			commitHash,
			fromHash,
			base.data?.baseBranch,
		],
		queryFn: () =>
			client.git.getDiff.query({
				workspaceId,
				path: selected?.path ?? "",
				category: selection?.category ?? "unstaged",
				baseBranch: base.data?.baseBranch ?? undefined,
				commitHash,
				fromHash,
			}),
		enabled: active && !!selected && !selected.isBinary,
		retry: false,
	});
	useEffect(() => {
		if (status.isPending || commitFiles.isFetching) return;
		const reconciled = [
			...new Map(
				diffTabs.flatMap((tab) => {
					const same = groups
						.find((group) => group.category === tab.category)
						?.files.find((file) => file.path === tab.path);
					if (same) return [[changeKey(tab), tab] as const];
					const match = groups.find((group) =>
						group.files.some((file) => file.path === tab.path),
					);
					const next = match
						? { category: match.category, path: tab.path }
						: null;
					return next ? [[changeKey(next), next] as const] : [];
				}),
			).values(),
		];
		if (
			reconciled.map(changeKey).join("\n") !==
			diffTabs.map(changeKey).join("\n")
		)
			setDiffTabs(reconciled);
		if (!selection) return;
		if (!selected) {
			const file = groups
				.flatMap((group) =>
					group.files.map((file) => ({ category: group.category, file })),
				)
				.find((item) => item.file.path === selection.path);
			setSelection(
				file ? { category: file.category, path: file.file.path } : null,
			);
		}
	}, [
		selection,
		status.isPending,
		commitFiles.isFetching,
		selected,
		groups,
		diffTabs,
	]);
	const refresh = async () => {
		const results = await Promise.all([
			status.refetch(),
			sync.refetch(),
			base.refetch(),
			branches.refetch(),
			commits.refetch(),
			conflicts.refetch(),
			preview.refetch(),
		]);
		if (results.some((item) => item.isError))
			setError(
				results.find((item) => item.error)?.error?.message ??
					t({ message: "Refresh failed" }),
			);
		if (unknown && !results[0].isError && !results[4].isError) setChecked(true);
	};
	const run = async (name: string, action: () => Promise<void>) => {
		if (operationRef.current || locks.current.size) return;
		operationRef.current = name;
		setOperation(name);
		setError(null);
		setResult(null);
		try {
			await action();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			operationRef.current = null;
			setOperation(null);
			await cache.invalidateQueries({ queryKey: statusKey });
			void sync.refetch();
		}
	};
	const stage = async (file: ChangedFile, category: Category) => {
		const key = file.path;
		if (locks.current.has(key) || operationRef.current) return;
		locks.current.add(key);
		setPending(new Set(locks.current));
		setError(null);
		try {
			await (category === "staged"
				? client.git.unstageFile
				: client.git.stageFile
			).mutate({ workspaceId, filePath: file.path, oldPath: file.oldPath });
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			locks.current.delete(key);
			setPending(new Set(locks.current));
			await cache.invalidateQueries({ queryKey: statusKey });
		}
	};
	const copy = async (path: string) => {
		try {
			await navigator.clipboard.writeText(path);
			setResult(t({ message: "Relative path copied" }));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};
	const currentBranch = status.data?.currentBranch.name ?? "";
	const dirty =
		!!status.data &&
		(status.data.staged.length > 0 || status.data.unstaged.length > 0);
	const busy = !!operation || pending.size > 0;
	const requestCommit = () => {
		if (
			!status.data ||
			busy ||
			unknown ||
			!message.trim() ||
			!status.data.staged.length
		)
			return;
		setConfirmError(null);
		setConfirmation({
			kind: "commit",
			branch: currentBranch,
			head: status.data.currentBranch.lastCommitHash,
			files: status.data.staged,
			message,
		});
	};
	const confirm = async () => {
		const target = confirmation;
		if (!target || busy || unknown) return;
		setConfirmError(null);
		await run(target.kind, async () => {
			try {
				if (target.kind === "push") {
					try {
						await client.git.pushReviewed.mutate({
							workspaceId,
							confirmationToken: target.preview.confirmationToken,
						});
						setResult(t({ message: "Push completed" }));
					} catch (cause) {
						const code = (cause as { data?: { code?: string } })?.data?.code;
						if (code === "CONFLICT") {
							setConfirmation(null);
							void preview.refetch();
							throw cause;
						}
						setUnknown(true);
						setChecked(false);
						throw cause;
					}
				} else {
					const fresh = await client.git.getStatus.query({ workspaceId });
					if (
						fresh.currentBranch.name !==
						(target.kind === "checkout" ? target.source : target.branch)
					)
						throw new Error(
							t({
								message:
									"The branch changed. Review the current branch before trying again.",
							}),
						);
					if (target.kind === "commit") {
						if (
							fresh.currentBranch.lastCommitHash !== target.head ||
							signature(fresh.staged) !== signature(target.files)
						)
							throw new Error(
								t({
									message:
										"The staged files changed. Review them before committing.",
								}),
							);
						try {
							const completed = await client.git.commit.mutate({
								workspaceId,
								message: target.message,
								stageAll: false,
							});
							setMessage("");
							setResult(t({ message: `Created commit ${completed.hash}` }));
						} catch (cause) {
							const code = (cause as { data?: { code?: string } })?.data?.code;
							if (
								!code ||
								[
									"INTERNAL_SERVER_ERROR",
									"TIMEOUT",
									"GATEWAY_TIMEOUT",
									"BAD_GATEWAY",
									"CLIENT_CLOSED_REQUEST",
								].includes(code)
							) {
								setUnknown(true);
								setChecked(false);
							}
							throw cause;
						}
					} else if (target.kind === "discard") {
						const file = fresh.unstaged.find(
							(file) => file.path === target.file.path,
						);
						if (
							!file ||
							file.status !== target.file.status ||
							file.oldPath !== target.file.oldPath
						)
							throw new Error(
								t({
									message:
										"The file changed. Review its diff before discarding.",
								}),
							);
						await client.git.discardChanges.mutate({
							workspaceId,
							filePath: file.path,
						});
						setResult(t({ message: "Changes discarded" }));
					} else {
						if (
							!getHasUnsavedFiles ||
							getHasUnsavedFiles() ||
							fresh.staged.length ||
							fresh.unstaged.length
						)
							throw new Error(
								t({
									message:
										"Save or close unsaved files and commit or discard changes before switching branches.",
								}),
							);
						await client.git.checkoutBranch.mutate({
							workspaceId,
							branch: target.branch,
						});
						setFilter({ kind: "all" });
						setSelection(null);
						setResult(t({ message: "Branch switched" }));
					}
				}
				setConfirmation(null);
			} catch (cause) {
				setConfirmError(cause instanceof Error ? cause.message : String(cause));
				throw cause;
			}
		});
	};
	const requestDiscard = (file: ChangedFile) => {
		if (file.status === "renamed" || file.status === "copied") {
			setError(
				t({
					message:
						"Discarding renamed or copied files is unavailable. Restore both paths with Git.",
				}),
			);
			return;
		}
		setConfirmError(null);
		setConfirmation({ kind: "discard", branch: currentBranch, file });
	};
	const select = (file: ChangedFile, category: Category, newTab = false) => {
		const next = { path: file.path, category };
		if (
			newTab &&
			diffTabs.length >= 8 &&
			!diffTabs.some((tab) => changeKey(tab) === changeKey(next))
		) {
			setError(
				t({
					message:
						"Close a diff tab before opening another. At most eight diffs can be open.",
				}),
			);
			return;
		}
		setDiffTabs((tabs) => {
			if (tabs.some((tab) => changeKey(tab) === changeKey(next))) return tabs;
			if (newTab || !selection) return [...tabs, next];
			const current = tabs.findIndex(
				(tab) => changeKey(tab) === changeKey(selection),
			);
			return current < 0
				? [next]
				: tabs.map((tab, index) => (index === current ? next : tab));
		});
		setSelection(next);
	};
	const closeDiffTabs = (keys: string[]) => {
		const remaining = diffTabs.filter((tab) => !keys.includes(changeKey(tab)));
		setDiffTabs(remaining);
		if (selection && keys.includes(changeKey(selection)))
			setSelection(remaining.at(-1) ?? null);
	};

	const noChanges =
		status.data && groups.every((group) => group.files.length === 0);
	return (
		<section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
			<header
				hidden={!!shipOnly}
				className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3"
			>
				<h2 className="min-w-0 flex-1 truncate text-sm font-medium">
					<Trans>Changes</Trans>
				</h2>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 min-w-0 max-w-56 gap-1 text-xs"
							disabled={!status.data || busy}
						>
							<GitBranch className="size-3.5 shrink-0" />
							<span className="truncate">{currentBranch}</span>
							<ChevronDown className="size-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="max-h-80 overflow-auto">
						{(branches.data?.branches ?? []).map((branch) => (
							<DropdownMenuItem
								key={branch.name}
								disabled={
									branch.isHead ||
									busy ||
									dirty ||
									!getHasUnsavedFiles ||
									getHasUnsavedFiles()
								}
								onSelect={() => {
									setConfirmError(null);
									setConfirmation({
										kind: "checkout",
										branch: branch.name,
										source: currentBranch,
									});
								}}
							>
								<GitBranch />
								<span className="truncate">{branch.name}</span>
							</DropdownMenuItem>
						))}
						{dirty && (
							<div className="max-w-64 px-2 py-1 text-xs text-muted-foreground">
								<Trans>
									Commit or discard changes before switching branches.
								</Trans>
							</div>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={busy || !currentBranch || currentBranch === "HEAD"}
							onSelect={() =>
								void run("fetch", async () => {
									await client.git.fetchBranches.mutate({
										workspaceId,
										branches: [currentBranch],
									});
									setResult(t({ message: "Fetch completed" }));
								})
							}
						>
							<RefreshCw />
							<Trans>Fetch current branch from origin</Trans>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<Button
					variant="ghost"
					size="icon"
					className="size-6"
					aria-label={t({ message: "Refresh" })}
					title={t({ message: "Refresh" })}
					disabled={status.isFetching || busy}
					onClick={() => void refresh()}
				>
					<RefreshCw
						className={`size-3.5 ${status.isFetching ? "animate-spin" : ""}`}
					/>
				</Button>
			</header>
			{(error || status.error || sync.error) && (
				<p
					role="alert"
					className="max-h-32 shrink-0 overflow-auto whitespace-pre-wrap break-words border-b border-destructive/30 px-3 py-2 text-xs text-destructive"
				>
					{error ||
						status.error?.message ||
						sync.error?.message ||
						conflicts.error?.message}
				</p>
			)}
			{result && (
				<output className="border-b px-3 py-1.5 text-xs text-muted-foreground">
					{result}
				</output>
			)}
			{unknown && (
				<div
					role="alert"
					className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs"
				>
					<span className="min-w-0 flex-1">
						<Trans>
							The operation result is unknown. Check the branch history and
							remote before retrying.
						</Trans>
					</span>
					<Button
						size="sm"
						variant="outline"
						className="h-6 text-xs"
						disabled={busy}
						onClick={() => void refresh()}
					>
						<Trans>Check status</Trans>
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-6 text-xs"
						disabled={!checked || busy}
						onClick={() => {
							setUnknown(false);
							setConfirmation(null);
						}}
					>
						<Trans>I checked the result</Trans>
					</Button>
				</div>
			)}
			{conflicts.error && (
				<p className="border-b px-3 py-1 text-xs text-muted-foreground">
					{conflicts.error.message}
				</p>
			)}
			{!!conflicts.data?.paths.length && (
				<div className="max-h-32 shrink-0 overflow-auto border-b p-2 text-xs text-destructive">
					<p>
						<Trans>Resolve these conflicts before committing.</Trans>
					</p>
					{conflicts.data.paths.map((path) => (
						<button
							key={path}
							type="button"
							className="block w-full truncate py-1 text-left underline"
							onClick={() => onOpenFile(path)}
						>
							{path}
						</button>
					))}
				</div>
			)}
			{shipOnly ? (
				<div className="space-y-2">
					{shipOnly === "commit" ? (
						<>
							<CommitForm
								message={message}
								onMessageChange={setMessage}
								onCommit={requestCommit}
								busy={operation === "commit"}
								disabled={
									busy ||
									unknown ||
									!status.data?.staged.length ||
									!!conflicts.data?.paths.length
								}
								branch={currentBranch}
								stagedCount={status.data?.staged.length ?? 0}
							/>
							<Button
								size="sm"
								variant="ghost"
								disabled={busy || unknown || !status.data?.unstaged.length}
								onClick={() =>
									void run("stage-all", async () => {
										await client.git.stageAll.mutate({ workspaceId });
									})
								}
							>
								<Trans>Stage all changes</Trans>
							</Button>
						</>
					) : (
						<div className="space-y-2 p-2">
							<p className="text-xs text-muted-foreground">
								{currentBranch} · ↑{formatNumber(sync.data?.pushCount ?? 0)} ↓
								{formatNumber(sync.data?.pullCount ?? 0)}
							</p>
							<Button
								size="sm"
								disabled={busy || unknown || preview.data?.status !== "ready"}
								onClick={() => {
									if (preview.data?.status === "ready") {
										setConfirmError(null);
										setConfirmation({ kind: "push", preview: preview.data });
									}
								}}
							>
								<Upload className="size-3" />
								<Trans>Push</Trans>
							</Button>
							{(preview.error || preview.data?.status === "unsupported") && (
								<p className="text-xs text-muted-foreground">
									{preview.error?.message ??
										(preview.data?.status === "unsupported"
											? preview.data.reason
											: "")}
								</p>
							)}
						</div>
					)}
				</div>
			) : (
				<div className="flex min-h-0 min-w-0 flex-1 overflow-x-auto">
					<aside className="flex w-72 min-w-52 max-w-[45%] shrink-0 flex-col border-r border-border bg-sidebar/30">
						<CommitForm
							message={message}
							onMessageChange={setMessage}
							onCommit={requestCommit}
							busy={operation === "commit"}
							disabled={
								busy ||
								unknown ||
								!status.data?.staged.length ||
								!!conflicts.data?.paths.length
							}
							branch={currentBranch}
							stagedCount={status.data?.staged.length ?? 0}
						/>
						<div className="flex items-center gap-2 border-b px-2 py-1.5 text-xs text-muted-foreground">
							<span className="min-w-0 flex-1 truncate">
								↑{formatNumber(sync.data?.pushCount ?? 0)} ↓
								{formatNumber(sync.data?.pullCount ?? 0)}
							</span>
							<Button
								variant="ghost"
								size="sm"
								className="h-6 gap-1 text-xs"
								disabled={busy || unknown || preview.data?.status !== "ready"}
								title={
									preview.error?.message ??
									(preview.data?.status === "unsupported"
										? preview.data.reason
										: undefined)
								}
								onClick={() => {
									if (preview.data?.status === "ready") {
										setConfirmError(null);
										setConfirmation({ kind: "push", preview: preview.data });
									}
								}}
							>
								<Upload className="size-3" />
								<Trans>Push</Trans>
							</Button>
						</div>
						{(preview.error || preview.data?.status === "unsupported") && (
							<p className="border-b px-2 py-1 text-xs text-muted-foreground">
								{preview.error?.message ??
									(preview.data?.status === "unsupported"
										? preview.data.reason
										: "")}
							</p>
						)}
						<ChangesToolbar
							filter={filter}
							onFilterChange={(value) => {
								setFilter(value);
								setDiffTabs([]);
								setSelection(null);
							}}
							commits={commits.data?.commits ?? []}
							uncommittedCount={
								new Set(
									[
										...(status.data?.staged ?? []),
										...(status.data?.unstaged ?? []),
									].map((file) => file.path),
								).size
							}
							viewMode={mode}
							onViewModeChange={setMode}
							collapsed={collapsed}
							onToggleFold={toggleFold}
							searchOpen={searchOpen}
							onToggleSearch={() => {
								setSearchOpen((value) => !value);
								setSearch("");
							}}
							baseBranch={
								base.data?.baseBranch ?? status.data?.defaultBranch.name ?? ""
							}
							branches={branches.data?.branches ?? []}
							onBaseBranchChange={(branch) =>
								void run("base", async () => {
									await client.git.setBaseBranch.mutate({
										workspaceId,
										baseBranch: branch,
									});
									await base.refetch();
									setSelection(null);
								})
							}
							currentBranchName={currentBranch}
							canRenameBranch={
								!!currentBranch &&
								currentBranch !== "HEAD" &&
								!busy &&
								!status.data?.currentBranch.upstream
							}
							onRenameBranch={(newName) =>
								void run("rename", async () => {
									await client.git.renameBranch.mutate({
										workspaceId,
										oldName: currentBranch,
										newName,
									});
									await branches.refetch();
								})
							}
						/>
						{searchOpen && (
							<div className="px-2 pb-2">
								<Input
									autoFocus
									aria-label={t({ message: "Search changed files" })}
									placeholder={t({ message: "Search changed files" })}
									className="h-7 text-xs"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Escape") {
											event.stopPropagation();
											setSearchOpen(false);
											setSearch("");
										}
									}}
								/>
							</div>
						)}
						{(base.error ||
							branches.error ||
							commits.error ||
							commitFiles.error) && (
							<p role="alert" className="px-2 text-xs text-destructive">
								{base.error?.message ||
									branches.error?.message ||
									commits.error?.message ||
									commitFiles.error?.message}
							</p>
						)}
						<div
							data-changes-scroll-container
							className="min-h-0 flex-1 overflow-y-auto py-1"
						>
							{(status.isPending || commitFiles.isFetching) && (
								<output className="flex items-center gap-1 p-3 text-xs text-muted-foreground">
									<Loader2 className="size-3.5 animate-spin" />
									<Trans>Loading changes…</Trans>
								</output>
							)}
							{noChanges && (
								<p className="p-3 text-xs text-muted-foreground">
									<Trans>No changes</Trans>
								</p>
							)}
							{groups.map((group) => {
								const files = group.files.filter((file) =>
									`${file.path}\n${file.oldPath ?? ""}`
										.toLocaleLowerCase()
										.includes(search.toLocaleLowerCase()),
								);
								return (
									<details key={group.category} open className="mb-1">
										<summary className="flex cursor-pointer items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground">
											<span className="min-w-0 flex-1 truncate">
												{group.label}
											</span>
											<span>{formatNumber(files.length)}</span>
											{group.category !== "against-base" &&
												group.category !== "commit" && (
													<Button
														size="icon"
														variant="ghost"
														className="size-5"
														disabled={busy || !group.files.length}
														aria-label={
															group.category === "staged"
																? t({ message: "Unstage All" })
																: t({ message: "Stage All" })
														}
														title={
															group.category === "staged"
																? t({ message: "Unstage All" })
																: t({ message: "Stage All" })
														}
														onClick={(event) => {
															event.preventDefault();
															event.stopPropagation();
															void run("stage-all", async () => {
																await (group.category === "staged"
																	? client.git.unstageAll
																	: client.git.stageAll
																).mutate({ workspaceId });
															});
														}}
													>
														{group.category === "staged" ? (
															<Minus className="size-3" />
														) : (
															<Plus className="size-3" />
														)}
													</Button>
												)}
										</summary>
										{mode === "tree" ? (
											<ChangesTree
												files={files}
												category={group.category}
												foldSignal={foldSignal}
												selectedPath={
													selection?.category === group.category
														? selection.path
														: undefined
												}
												onSelect={(file, newTab) =>
													select(file, group.category, newTab)
												}
												onOpen={(file, pinned) => onOpenFile(file.path, pinned)}
												onStage={(file) => void stage(file, group.category)}
												onDiscard={requestDiscard}
												onExternal={(path) => void openExternal(path)}
												remote={remote || !rootPath}
												rootPath={rootPath}
												onCopy={(path) => void copy(path)}
												isPending={(file) =>
													pending.has(file.path) || !!operation
												}
											/>
										) : (
											<ChangedFileFolderList
												files={files}
												getFileKey={(file) => file.path}
												foldSignal={foldSignal}
												renderFile={(file) => (
													<ChangesRow
														file={file}
														category={group.category}
														selected={
															selection?.category === group.category &&
															selection.path === file.path
														}
														busy={pending.has(file.path) || !!operation}
														onSelect={(newTab) =>
															select(file, group.category, newTab)
														}
														onOpen={(pinned) => onOpenFile(file.path, pinned)}
														onStage={() => void stage(file, group.category)}
														onDiscard={() => requestDiscard(file)}
														onExternal={(path) => void openExternal(path)}
														remote={remote || !rootPath}
														rootPath={rootPath}
														onCopy={(path) => void copy(path)}
													/>
												)}
											/>
										)}
										{search && files.length === 0 && (
											<p className="px-3 py-1 text-xs text-muted-foreground">
												<Trans>No files found</Trans>
											</p>
										)}
									</details>
								);
							})}
						</div>
					</aside>
					<div className="flex min-h-0 min-w-64 flex-1 flex-col">
						{!!diffTabs.length && (
							<ChangesDiffTabs
								tabs={diffTabs}
								selected={selection}
								onSelect={setSelection}
								onClose={closeDiffTabs}
							/>
						)}
						{selected && selection ? (
							<>
								<div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1 text-xs">
									<span
										className="min-w-0 flex-1 truncate"
										title={
											selected.oldPath
												? `${selected.oldPath} → ${selected.path}`
												: selected.path
										}
									>
										{selected.oldPath && (
											<span className="text-muted-foreground">
												{selected.oldPath} →{" "}
											</span>
										)}
										{selected.path}
									</span>
									<Button
										size="sm"
										variant={view === "side-by-side" ? "secondary" : "ghost"}
										className="h-6 text-xs"
										onClick={() => setView("side-by-side")}
									>
										<Trans>Side by side</Trans>
									</Button>
									<Button
										size="sm"
										variant={view === "inline" ? "secondary" : "ghost"}
										className="h-6 text-xs"
										onClick={() => setView("inline")}
									>
										<Trans>Inline</Trans>
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="h-6 text-xs"
										disabled={selected.status === "deleted"}
										onClick={() => onOpenFile(selected.path)}
									>
										<Trans>Files</Trans>
									</Button>
								</div>
								<div className="min-h-0 flex-1 overflow-auto">
									{selected.isBinary ? (
										<p className="p-4 text-xs text-muted-foreground">
											<Trans>Binary file</Trans>
										</p>
									) : diff.isPending ? (
										<output className="block p-4 text-xs text-muted-foreground">
											<Trans>Loading changes…</Trans>
										</output>
									) : diff.error ? (
										<div role="alert" className="p-4 text-xs text-destructive">
											{diff.error.message}
											<Button
												variant="ghost"
												size="sm"
												onClick={() => void diff.refetch()}
											>
												<Trans>Retry</Trans>
											</Button>
										</div>
									) : diff.data ? (
										<LightDiffViewer
											filePath={selected.path}
											viewMode={view}
											hideUnchangedRegions
											contents={{
												language: detectLanguage(selected.path),
												original: diff.data.oldFile.contents,
												modified: diff.data.newFile.contents,
											}}
										/>
									) : null}
								</div>
							</>
						) : (
							<div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
								<Trans>Select a file to preview or edit</Trans>
							</div>
						)}
					</div>
				</div>
			)}

			{confirmation && (
				<GitConfirmDialog
					title={
						confirmation.kind === "commit"
							? t({ message: "Commit staged changes" })
							: confirmation.kind === "push"
								? t({ message: "Push changes?" })
								: confirmation.kind === "checkout"
									? t({ message: "Switch branch?" })
									: t({ message: "Discard Changes" })
					}
					description={
						confirmation.kind === "discard"
							? t({
									message:
										"This restores the file in the index and on disk to HEAD, or deletes an untracked file. Unsaved editor buffers are kept. This action cannot be undone.",
								})
							: confirmation.kind === "commit"
								? t({
										message:
											"Only the listed staged files will be committed. Hooks may modify files or reject the commit.",
									})
								: confirmation.kind === "push"
									? t({
											message:
												"Push this commit to the reviewed remote branch. A changed target requires a new confirmation.",
										})
									: t({
											message:
												"The workspace files will change to the selected branch.",
										})
					}
					label={
						confirmation.kind === "commit"
							? t({ message: "Commit" })
							: confirmation.kind === "push"
								? t({ message: "Push" })
								: confirmation.kind === "checkout"
									? t({ message: "Switch branch" })
									: t({ message: "Discard" })
					}
					destructive={confirmation.kind === "discard"}
					busy={!!operation}
					disabled={unknown}
					error={confirmError}
					onCancel={() => {
						setConfirmation(null);
						setConfirmError(null);
					}}
					onConfirm={() => void confirm()}
				>
					{confirmation.kind === "push" ? (
						<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
							<dt>
								<Trans>Branch</Trans>
							</dt>
							<dd>
								{confirmation.preview.sourceBranch} →{" "}
								{confirmation.preview.targetBranch}
							</dd>
							<dt>
								<Trans>Remote</Trans>
							</dt>
							<dd>
								{confirmation.preview.remote} · {confirmation.preview.remoteUrl}
							</dd>
							<dt>
								<Trans>Commit</Trans>
							</dt>
							<dd>{confirmation.preview.head}</dd>
						</dl>
					) : confirmation.kind === "commit" ? (
						<>
							<p className="mb-2 font-medium">{confirmation.branch}</p>
							<ul className="list-inside list-disc">
								{confirmation.files.map((file) => (
									<li key={file.path}>
										{file.oldPath ? `${file.oldPath} → ` : ""}
										{file.path}
									</li>
								))}
							</ul>
							<pre className="mt-2 whitespace-pre-wrap">
								{confirmation.message}
							</pre>
						</>
					) : confirmation.kind === "checkout" ? (
						<p>
							{confirmation.source} → {confirmation.branch}
						</p>
					) : (
						<p>
							{confirmation.file.path} · {confirmation.branch}
						</p>
					)}
				</GitConfirmDialog>
			)}
		</section>
	);
}
