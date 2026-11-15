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
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import {
	LuCircle,
	LuCircleAlert,
	LuCircleCheck,
	LuFolderGit2,
	LuLoaderCircle,
} from "react-icons/lu";
import type { ProjectActionContext } from "../../../../../JedvProjectActions";
import type { WelcomeImportResult } from "../../../../types";
import {
	type ExternalRepo,
	type ImportItemState,
	importExternalWorktrees,
} from "../../../../utils/importExternalWorktrees";
import type { ExternalWorktreeSource } from "../../constants";
import { ToolIcon } from "../ToolIcon";
import { ToolIconStack } from "../ToolIconStack";

export function ImportFromOtherToolsDialog({
	context,
	repos,
	onClose,
	onImported,
}: {
	context: ProjectActionContext;
	repos: ExternalRepo[];
	onClose(): void;
	onImported(result: WelcomeImportResult): Promise<void>;
}) {
	const { t } = useLingui();
	const [target] = useState(() => ({ ...context }));
	const [offer] = useState(() => repos);
	const id = useId();
	const ids = useRef(new Map<string, string>());
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [status, setStatus] = useState<Record<string, ImportItemState>>({});
	const [phase, setPhase] = useState<"choose" | "importing" | "done">("choose");
	const [finishing, setFinishing] = useState(false);
	const busy = useRef(false);
	const outcome = useRef<{ projectId: string | null; workspaceIds: string[] }>({
		projectId: null,
		workspaceIds: [],
	});
	const [error, setError] = useState<string | null>(null);
	const sources = [
		...new Set(
			offer.flatMap((repo) => repo.worktrees.map((row) => row.source)),
		),
	] as ExternalWorktreeSource[];
	const failed = Object.entries(status)
		.filter(([, item]) => item.state === "failed")
		.map(([path]) => path);
	const imported = Object.values(status).filter(
		(item) => item.state === "done",
	).length;
	const run = async (paths: ReadonlySet<string>) => {
		if (busy.current || paths.size === 0) return;
		busy.current = true;
		setPhase("importing");
		setError(null);
		try {
			const result = await importExternalWorktrees({
				client: target.client,
				repos: offer,
				selectedPaths: paths,
				idForPath: (path) => {
					let value = ids.current.get(path);
					if (!value) {
						value = crypto.randomUUID();
						ids.current.set(path, value);
					}
					return value;
				},
				onStatus: (path, item) =>
					setStatus((current) => ({ ...current, [path]: item })),
				messages: {
					repoUnavailable: t({
						message:
							"This repository is no longer available as a Git repository.",
					}),
					multipleProjects: t({
						message:
							"Multiple projects match this repository. Open the project first and import its worktrees.",
					}),
					importFailed: t({ message: "Could not import workspace" }),
				},
			});
			if (
				outcome.current.workspaceIds.length === 0 &&
				result.firstSuccessfulProjectId
			)
				outcome.current.projectId = result.firstSuccessfulProjectId;
			else outcome.current.projectId ??= result.projectIds[0] ?? null;
			outcome.current.workspaceIds = [
				...new Set([...outcome.current.workspaceIds, ...result.workspaceIds]),
			];
		} catch {
			setError(
				t({
					message: "Could not finish importing. Successful imports are kept.",
				}),
			);
		} finally {
			setPhase("done");
			busy.current = false;
		}
	};
	const finish = async () => {
		if (busy.current) return;
		busy.current = true;
		setFinishing(true);
		setError(null);
		try {
			await onImported({ context: target, ...outcome.current });
			onClose();
		} catch {
			setError(
				t({
					message:
						"Your imports are saved. Could not refresh or open them. Try continuing again.",
				}),
			);
		} finally {
			busy.current = false;
			setFinishing(false);
		}
	};
	return (
		<Dialog
			open
			modal
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent
				className="max-w-lg gap-5"
				showCloseButton={phase !== "importing" && !finishing}
			>
				<DialogHeader>
					<ToolIconStack sources={sources} />
					<DialogTitle>
						{phase === "done"
							? t({ message: "Import results" })
							: t({ message: "Import from other tools" })}
					</DialogTitle>
					<DialogDescription>
						{target.hostLabel}
						<br />
						<Trans>
							Select existing worktrees to import. Files stay in place and setup
							commands will not run.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<div className="-mx-1 flex max-h-72 flex-col gap-4 overflow-y-auto px-1">
					{offer.map((repo, repoIndex) => (
						<section key={repo.repoPath} className="flex flex-col gap-1">
							<div className="flex min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground">
								<LuFolderGit2 className="size-3.5 shrink-0" />
								<span className="font-medium text-foreground">{repo.name}</span>
								<span className="truncate" title={repo.repoPath}>
									{repo.repoPath}
								</span>
							</div>
							<ul>
								{repo.worktrees
									.filter((row) => phase === "choose" || selected.has(row.path))
									.map((row, index) => {
										const item = status[row.path];
										const checkboxId = `${id}-${repoIndex}-${index}`;
										return (
											<li key={row.path} className="py-1">
												<label
													htmlFor={checkboxId}
													className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-accent/40"
												>
													{phase === "choose" ? (
														<Checkbox
															id={checkboxId}
															checked={selected.has(row.path)}
															onCheckedChange={(value) =>
																setSelected((current) => {
																	const next = new Set(current);
																	if (value === true) next.add(row.path);
																	else next.delete(row.path);
																	return next;
																})
															}
														/>
													) : (
														<span className="grid size-4 shrink-0 place-items-center">
															{item?.state === "done" ? (
																<LuCircleCheck className="size-4 text-emerald-500" />
															) : item?.state === "failed" ? (
																<LuCircleAlert className="size-4 text-destructive" />
															) : item?.state === "importing" ? (
																<LuLoaderCircle className="size-4 animate-spin" />
															) : (
																<LuCircle className="size-3.5 text-muted-foreground" />
															)}
														</span>
													)}
													<ToolIcon
														source={row.source}
														className="size-4 rounded-[4px] text-[8px]"
													/>
													<span className="flex min-w-0 flex-1 flex-col">
														<span className="truncate font-mono text-[13px]">
															{row.branch}
														</span>
														<span
															className="truncate text-xs text-muted-foreground"
															title={row.path}
														>
															{row.path}
														</span>
														{item?.state === "failed" && (
															<span
																role="alert"
																className="break-words text-xs text-destructive"
															>
																{item.error}
															</span>
														)}
													</span>
												</label>
											</li>
										);
									})}
							</ul>
						</section>
					))}
				</div>
				{phase === "importing" && (
					<output className="text-xs text-muted-foreground">
						<Trans>Importing selected workspaces…</Trans>
					</output>
				)}
				{phase === "done" && (
					<p className="text-xs text-muted-foreground">
						<Trans>
							{imported} imported, {failed.length} failed. Successful imports
							are kept.
						</Trans>
					</p>
				)}
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				<DialogFooter>
					{phase === "choose" ? (
						<>
							<Button variant="outline" onClick={onClose}>
								<Trans>Cancel</Trans>
							</Button>
							<Button
								disabled={selected.size === 0}
								onClick={() => void run(selected)}
							>
								<Trans>Import selected</Trans>
							</Button>
						</>
					) : phase === "done" ? (
						<>
							{failed.length > 0 && (
								<Button
									variant="outline"
									disabled={finishing}
									onClick={() => void run(new Set(failed))}
								>
									<Trans>Retry failed imports</Trans>
								</Button>
							)}
							<Button
								disabled={finishing}
								onClick={() => {
									if (outcome.current.projectId) void finish();
									else onClose();
								}}
							>
								{finishing ? <Trans>Opening…</Trans> : <Trans>Continue</Trans>}
							</Button>
						</>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
