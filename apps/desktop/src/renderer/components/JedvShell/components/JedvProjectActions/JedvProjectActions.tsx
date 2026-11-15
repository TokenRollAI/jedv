import { errorMessage, rawErrorMessage } from "@jedv/i18n/errors";
import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Trans, useLingui } from "@lingui/react/macro";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { LuLoaderCircle } from "react-icons/lu";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import {
	ensureLocalCheckout,
	LocalProjectError,
	openLocalProject,
} from "../../local-workflow";
import { HostDirectoryPicker } from "./HostDirectoryPicker";
import { ProjectForm } from "./ProjectForm";
import {
	deriveProjectNameFromUrl,
	directoryNameForProject,
	isAbsoluteHostPath,
	isRepositorySource,
	joinProjectPath,
	redactProjectError,
} from "./project-utils";
import { TemplateGallery } from "./TemplateGallery";
import { PROJECT_TEMPLATES } from "./templates";
import type {
	JedvProjectActionsHandle,
	JedvProjectActionsProps,
	ProjectActionContext,
	ProjectActionKind,
	ProjectDraft,
} from "./types";

interface ActionSession {
	sessionId: number;
	context: ProjectActionContext;
	kind: ProjectActionKind;
	draft: ProjectDraft;
}
interface UnknownCreation {
	operationId?: string;
	path: string;
	signature: string;
}
const emptyDraft = (): ProjectDraft => ({
	name: "",
	parentDir: "",
	url: "",
	repoPath: "",
	templateId: null,
	nameTouched: false,
});

export const JedvProjectActions = forwardRef<
	JedvProjectActionsHandle,
	JedvProjectActionsProps
>(function JedvProjectActions({ context, onRefresh, onOpened }, ref) {
	const { t } = useLingui();
	const queryClient = useQueryClient();

	const [session, setSession] = useState<ActionSession | null>(null);
	const sessionRef = useRef<ActionSession | null>(null);
	const folderAttempt = useRef<{ signature: string; id: string } | null>(null);
	const folderCapabilities = useQuery({
		queryKey: ["jedv", session?.context.hostUrl, "project-capabilities"],
		queryFn: session
			? () => session.context.client.project.capabilities.query()
			: skipToken,
		enabled: session?.kind === "folder",
		retry: false,
		gcTime: 30_000,
	});
	const sequence = useRef(0);
	const callbacks = useRef({ onRefresh, onOpened });
	callbacks.current = { onRefresh, onOpened };
	const busy = useRef(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [projectId, setProjectId] = useState<string | null>(null);
	const [unknowns, setUnknowns] = useState<Record<string, UnknownCreation>>({});
	const clearUnknown = (signature: string) =>
		setUnknowns((previous) => {
			const next = { ...previous };
			delete next[signature];
			return next;
		});
	const [browse, setBrowse] = useState(false);
	const [initPath, setInitPath] = useState<string | null>(null);
	const initResolver = useRef<((confirmed: boolean) => void) | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			initResolver.current?.(false);
			abortRef.current?.abort();
		};
	}, []);
	const update = (next: ActionSession | null) => {
		sessionRef.current = next;
		setSession(next);
	};
	const report = (failure: unknown) => {
		if (failure instanceof LocalProjectError) {
			if (failure.reason === "multiple-projects")
				return t({
					message:
						"Multiple projects use this directory. Choose the project in the sidebar.",
				});
			if (failure.reason === "empty-path")
				return t({ message: "Please select a project directory." });
			return t({
				message:
					"The project is saved, but its workspace could not be opened. Continue opening to retry without creating another project.",
			});
		}
		const raw = rawErrorMessage(failure);
		return raw.startsWith("Failed query:")
			? t({
					message:
						"Could not save the project. Check the project name and target location.",
				})
			: redactProjectError(errorMessage(failure));
	};
	const refresh = async (target: ProjectActionContext) => {
		const [projects, workspaces] = await Promise.all([
			target.client.project.list.query(),
			target.client.workspace.list.query(),
		]);
		queryClient.setQueryData(["jedv", target.hostUrl, "projects"], projects);
		queryClient.setQueryData(
			["jedv", target.hostUrl, "workspaces"],
			workspaces,
		);
		await callbacks.current.onRefresh(target);
	};
	const finish = async (
		target: ProjectActionContext,
		id: string,
		workspaceId: string,
	) => {
		await refresh(target);
		await callbacks.current.onOpened({
			context: target,
			projectId: id,
			workspaceId,
		});
		if (mounted.current) {
			update(null);
			setProjectId(null);
			setStatus(null);
		}
	};
	const checkoutActions = (target: ProjectActionContext) => ({
		listWorkspaces: () => target.client.workspace.list.query(),
		createWorkspace: (input: {
			projectId: string;
			checkout: "local";
			runSetup: false;
		}) => target.client.workspaces.create.mutate(input),
	});
	const run = async (target: ActionSession, work: () => Promise<void>) => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			await work();
		} catch (failure) {
			if (failure instanceof LocalProjectError && failure.projectId) {
				setProjectId(failure.projectId);
				await refresh(target.context).catch(() => {});
			}
			if (mounted.current) setError(report(failure));
		} finally {
			busy.current = false;
			if (mounted.current) {
				setPending(false);
				setInitPath(null);
			}
		}
	};
	const importPath = (target: ActionSession, path: string) =>
		run(target, async () => {
			if (!isAbsoluteHostPath(path))
				throw new Error(
					t({
						message: "Enter an absolute directory path on the target host.",
					}),
				);
			let id: string | undefined;
			setStatus(t({ message: "Checking project…" }));
			const workspaceId = await openLocalProject(
				{
					...checkoutActions(target.context),
					findProject: async (input) => {
						const result =
							await target.context.client.project.findByPath.query(input);
						id = result.candidates[0]?.id;
						return result;
					},
					importProject: async (input) => {
						setStatus(t({ message: "Importing project…" }));
						const result =
							await target.context.client.project.create.mutate(input);
						id = result.projectId;
						setProjectId(id);
						return result;
					},
					requestGitInit: (repoPath) =>
						new Promise((resolve) => {
							setInitPath(repoPath);
							initResolver.current = (confirmed) => {
								initResolver.current = null;
								setInitPath(null);
								resolve(confirmed);
							};
						}),
				},
				path,
			);
			if (workspaceId && id) {
				setProjectId(id);
				await finish(target.context, id, workspaceId);
			} else if (mounted.current) {
				setStatus(null);
				update(null);
			}
		});
	const importFolder = (target: ActionSession) =>
		run(target, async () => {
			const path = target.draft.repoPath.trim();
			if (!isAbsoluteHostPath(path))
				throw new Error(
					t({
						message: "Enter an absolute directory path on the target host.",
					}),
				);
			if (!target.draft.name.trim())
				throw new Error(t({ message: "Enter a project name and location." }));
			const support = await target.context.client.project.capabilities.query();
			if (!support.folderProjects)
				throw new Error(
					t({
						message:
							"This host does not support plain folders. Update the host and retry.",
					}),
				);
			const signature = JSON.stringify([
				target.context.hostUrl,
				path,
				target.draft.name.trim(),
			]);
			if (folderAttempt.current?.signature !== signature)
				folderAttempt.current = { signature, id: crypto.randomUUID() };
			setStatus(t({ message: "Importing project…" }));
			const created = await target.context.client.project.create.mutate({
				name: target.draft.name.trim(),
				operationId: folderAttempt.current.id,
				mode: { kind: "folder", repoPath: path },
			});
			setProjectId(created.projectId);
			const workspaceId = await ensureLocalCheckout(
				checkoutActions(target.context),
				created.projectId,
			);
			await finish(target.context, created.projectId, workspaceId);
		});
	const checkOutcome = async (
		target: ActionSession,
		recovery: UnknownCreation,
	) => {
		setStatus(
			t({ message: "Checking the target host for a completed project…" }),
		);
		if (recovery.operationId) {
			let operation: Awaited<
				ReturnType<
					ProjectActionContext["client"]["project"]["getCreateOperation"]["query"]
				>
			>;
			try {
				operation =
					await target.context.client.project.getCreateOperation.query(
						{ operationId: recovery.operationId },
						{ context: { skipBatch: true } },
					);
			} catch {
				setStatus(null);
				setError(
					t({
						message:
							"Could not confirm the operation on the target host. Check its connection and retry the result check.",
					}),
				);
				return;
			}
			if (operation.status === "running") {
				setStatus(
					t({
						message:
							"The target host is still processing this request. Check again before starting another operation here.",
					}),
				);
				return;
			}
			if (operation.status === "cancelled" || operation.status === "failed") {
				clearUnknown(recovery.signature);
				setError(null);
				setStatus(
					operation.status === "cancelled"
						? t({
								message:
									"The target host confirmed this operation has stopped. You can retry; if the target directory remains, choose another location.",
							})
						: t({
								message:
									"The target host confirmed this operation has ended. You can retry; an existing directory will not be overwritten.",
							}),
				);
				await refresh(target.context).catch(() => {});
				return;
			}
			if (operation.status === "completed") {
				setProjectId(operation.result.projectId);
				clearUnknown(recovery.signature);
				setError(null);
				setStatus(
					t({
						message: "The project was saved. Continue opening its workspace.",
					}),
				);
				await refresh(target.context).catch(() => {});
				return;
			}
		}
		let found: Awaited<
			ReturnType<
				ProjectActionContext["client"]["project"]["findByPath"]["query"]
			>
		>;
		try {
			found = await target.context.client.project.findByPath.query({
				repoPath: recovery.path,
			});
		} catch (failure) {
			setStatus(null);
			const missing =
				(failure as { data?: { code?: string } })?.data?.code ===
					"BAD_REQUEST" &&
				rawErrorMessage(failure) === `Path does not exist: ${recovery.path}`;
			setError(
				missing
					? t({
							message:
								"The target directory is missing, but the operation result is unknown. This does not confirm cancellation. Check the operation status again.",
						})
					: t({
							message:
								"Could not confirm the result on the target host. Check its connection and permissions, then check the result again.",
						}),
			);
			return;
		}
		const candidate =
			found?.candidates.length === 1 ? found.candidates[0] : null;
		if (candidate) {
			setProjectId(candidate.id);
			clearUnknown(recovery.signature);
			setStatus(
				t({
					message: "The project was saved. Continue opening its workspace.",
				}),
			);
		} else {
			setStatus(
				t({
					message:
						"No completed project was found yet. The host may still be stopping or finishing the operation. Check again before retrying at this location.",
				}),
			);
		}
		await refresh(target.context).catch(() => {});
	};
	const close = () => {
		if (initResolver.current) {
			initResolver.current(false);
			return;
		}
		if (busy.current) {
			if (abortRef.current) {
				abortRef.current.abort();
				setStatus(
					t({
						message:
							"Cancellation requested. Checking the host before another clone…",
					}),
				);
			}
			return;
		}
		update(null);
		setBrowse(false);
		setError(null);
		setStatus(null);
	};
	const browseDirectory = async (target: ActionSession, opening = false) => {
		if (target.context.isRemote) {
			setBrowse(true);
			return;
		}
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		let selected: string | null = null;
		try {
			const result = await electronTrpcClient.window.selectDirectory.mutate({
				title: t({ message: "Select project location" }),
				defaultPath: opening
					? target.draft.repoPath || undefined
					: target.draft.parentDir || undefined,
			});
			if (!result.canceled && result.path) selected = result.path;
			else if (opening) update(null);
		} catch (failure) {
			setError(report(failure));
		} finally {
			busy.current = false;
			setPending(false);
		}
		if (!selected) return;
		const next = {
			...target,
			draft: {
				...target.draft,
				[opening ? "repoPath" : "parentDir"]: selected,
				...(target.kind === "folder" && !target.draft.nameTouched
					? {
							name:
								selected
									.replace(/[\\/]+$/, "")
									.split(/[\\/]/)
									.at(-1) ?? "",
						}
					: {}),
			},
		};
		update(next);
		if (opening && target.kind !== "folder") await importPath(next, selected);
	};
	const launch = (kind: ProjectActionKind, path?: string) => {
		if (!context || busy.current || sessionRef.current) return;
		const next: ActionSession = {
			sessionId: ++sequence.current,
			context: { ...context },
			kind,
			draft: { ...emptyDraft(), repoPath: path ?? "" },
		};
		update(next);
		setError(null);
		setStatus(null);
		setBrowse(false);
		setProjectId(null);
		folderAttempt.current = null;
		if (kind === "folder") {
			if (!path) void browseDirectory(next, true);
		} else if (kind === "open") {
			if (path) void importPath(next, path);
			else void browseDirectory(next, true);
		} else {
			void next.context.client.filesystem.browseHost
				.query({})
				.then((result) => {
					const current = sessionRef.current;
					if (
						current?.sessionId !== next.sessionId ||
						!mounted.current ||
						current.draft.parentDir
					)
						return;
					update({
						...current,
						draft: {
							...current.draft,
							parentDir: joinProjectPath(result.homePath, ".jedv/projects"),
						},
					});
				})
				.catch(() => {});
		}
	};
	useImperativeHandle(ref, () => ({ open: launch }));
	const submit = async () => {
		const target = sessionRef.current;
		if (!target || busy.current) return;
		if (projectId) {
			const id = projectId;
			await run(target, async () => {
				setStatus(t({ message: "Opening workspace…" }));
				const workspaceId = await ensureLocalCheckout(
					checkoutActions(target.context),
					id,
				);
				await finish(target.context, id, workspaceId);
			});
			return;
		}
		if (target.kind === "folder") {
			await importFolder(target);
			return;
		}
		if (target.kind === "open") {
			await importPath(target, target.draft.repoPath);
			return;
		}
		const { name, parentDir, url } = target.draft;
		if (!name.trim() || !parentDir.trim()) {
			setError(t({ message: "Enter a project name and location." }));
			return;
		}
		if (!isAbsoluteHostPath(parentDir)) {
			setError(
				t({ message: "Enter an absolute directory path on the target host." }),
			);
			return;
		}
		if (target.kind === "clone" && !isRepositorySource(url)) {
			setError(
				t({
					message:
						"Enter a valid repository URL, SSH address, or absolute path on the target host. Remove query strings and fragments from GitHub URLs.",
				}),
			);
			return;
		}
		const directory =
			target.kind === "clone"
				? deriveProjectNameFromUrl(url)
				: directoryNameForProject(name);
		if (
			!directory ||
			directory === "." ||
			directory === ".." ||
			/[\\/]/.test(directory)
		) {
			setError(
				t({
					message:
						"Project name must produce a valid directory name. Use letters, numbers, dots, dashes, or underscores.",
				}),
			);
			return;
		}
		const path = joinProjectPath(parentDir.trim(), directory);
		const signature = JSON.stringify([target.context.hostUrl, path]);
		const unknown = unknowns[signature];
		if (unknown) {
			await run(target, () => checkOutcome(target, unknown));
			return;
		}
		await run(target, async () => {
			const abort =
				target.kind === "clone" || target.kind === "template"
					? new AbortController()
					: null;
			abortRef.current = abort;
			setStatus(
				target.kind === "clone"
					? t({ message: "Cloning repository…" })
					: target.kind === "template"
						? t({
								message: "Downloading template and creating fresh Git history…",
							})
						: t({ message: "Creating directory and initializing Git…" }),
			);
			const operationId = crypto.randomUUID();
			let created: { projectId: string };
			try {
				created = await target.context.client.project.create.mutate(
					{
						name: name.trim(),
						operationId,
						mode:
							target.kind === "empty"
								? { kind: "empty", parentDir: parentDir.trim() }
								: {
										kind: target.kind === "clone" ? "clone" : "template",
										parentDir: parentDir.trim(),
										url: url.trim(),
									},
					},
					abort
						? { signal: abort.signal, context: { skipBatch: true } }
						: { context: { skipBatch: true } },
				);
			} catch (failure) {
				const code = (failure as { data?: { code?: string } })?.data?.code;
				if (
					abort?.signal.aborted ||
					!code ||
					[
						"INTERNAL_SERVER_ERROR",
						"TIMEOUT",
						"CLIENT_CLOSED_REQUEST",
					].includes(code)
				) {
					const recovery = { path, signature, operationId };
					setUnknowns((previous) => ({ ...previous, [signature]: recovery }));
					setError(
						t({
							message:
								"The request ended before its result was confirmed. Check the target host for a completed project or partial directory before trying again.",
						}),
					);
					await checkOutcome(target, recovery);
					return;
				}
				throw failure;
			} finally {
				abortRef.current = null;
			}
			setProjectId(created.projectId);
			setStatus(t({ message: "Opening workspace…" }));
			const workspaceId = await ensureLocalCheckout(
				checkoutActions(target.context),
				created.projectId,
			);
			await finish(target.context, created.projectId, workspaceId);
		});
	};
	if (!session) return null;
	const { kind, draft } = session;
	const selectedTemplate = PROJECT_TEMPLATES.find(
		(item) => item.id === draft.templateId,
	);
	const gallery = kind === "template" && !selectedTemplate;
	const cancellable = kind === "clone" || kind === "template";
	const title =
		kind === "folder"
			? t({ message: "Import plain folder" })
			: kind === "open"
				? t({ message: "Open project" })
				: kind === "clone"
					? t({ message: "Clone a repository" })
					: kind === "empty"
						? t({ message: "Create a new project" })
						: t({ message: "Start from a template" });
	const targetSignature = JSON.stringify([
		session.context.hostUrl,
		joinProjectPath(
			draft.parentDir.trim(),
			kind === "clone"
				? deriveProjectNameFromUrl(draft.url)
				: directoryNameForProject(draft.name),
		),
	]);
	const unresolved = !!unknowns[targetSignature];
	return (
		<>
			<Dialog
				open
				modal
				onOpenChange={(open) => {
					if (!open) close();
				}}
			>
				<DialogContent
					className={
						gallery
							? "max-h-[85vh] overflow-y-auto sm:max-w-5xl"
							: "max-h-[85vh] overflow-y-auto sm:max-w-[420px]"
					}
					showCloseButton={!pending || cancellable || !!initPath}
					onInteractOutside={(event) => {
						if (pending) event.preventDefault();
					}}
					onEscapeKeyDown={(event) => {
						if (pending && !cancellable && !initPath) event.preventDefault();
					}}
				>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>
							{kind === "folder" ? (
								<Trans>
									Use this directory for terminals and files without
									initializing Git.
								</Trans>
							) : kind === "open" ? (
								<Trans>
									Open an existing repository, or initialize a folder after
									confirmation.
								</Trans>
							) : kind === "empty" ? (
								<Trans>
									Create a blank folder and initialize it as a Git repository.
								</Trans>
							) : kind === "template" ? (
								<Trans>
									Scaffold a new project from a starter with fresh Git history.
									Setup commands will not run automatically.
								</Trans>
							) : (
								<Trans>
									Create a new project by cloning a repository or local path.
								</Trans>
							)}
						</DialogDescription>
					</DialogHeader>
					<p className="break-all text-xs text-muted-foreground">
						<Trans>Target host: {session.context.hostLabel}</Trans>
					</p>
					{initPath ? (
						<div className="flex flex-col gap-3">
							<h3 className="text-sm font-medium">
								<Trans>Initialize Git repository?</Trans>
							</h3>
							<p className="break-all font-mono text-xs">{initPath}</p>
							<p className="text-xs text-muted-foreground">
								<Trans>
									This folder is not a Git repository. Initialize Git here and
									import it as a project? Existing files will be kept.
								</Trans>
							</p>
							<DialogFooter>
								<Button
									variant="ghost"
									onClick={() => initResolver.current?.(false)}
								>
									<Trans>Cancel</Trans>
								</Button>
								<Button onClick={() => initResolver.current?.(true)}>
									<Trans>Initialize and open</Trans>
								</Button>
							</DialogFooter>
						</div>
					) : (
						<form
							className="flex flex-col gap-4"
							onSubmit={(event) => {
								event.preventDefault();
								void submit();
							}}
						>
							{kind === "template" && (
								<TemplateGallery
									selectedId={draft.templateId}
									disabled={pending || !!projectId}
									onSelect={(template) => {
										update({
											...session,
											draft: {
												...draft,
												templateId: template.id,
												url: template.repo ?? "",
												name: deriveProjectNameFromUrl(template.repo ?? ""),
											},
										});
										setError(null);
									}}
									onBack={() =>
										update({
											...session,
											draft: { ...draft, templateId: null },
										})
									}
								/>
							)}
							{!gallery && (
								<ProjectForm
									kind={kind}
									context={session.context}
									draft={draft}
									disabled={pending || !!projectId}
									onChange={(next) => {
										update({ ...session, draft: next });
										setError(null);
										setStatus(null);
									}}
									onBrowse={() =>
										void browseDirectory(
											session,
											kind === "open" || kind === "folder",
										)
									}
								/>
							)}
							{kind === "folder" &&
								(folderCapabilities.isPending ? (
									<output className="text-xs text-muted-foreground">
										<Trans>Loading…</Trans>
									</output>
								) : (
									(!folderCapabilities.data?.folderProjects ||
										folderCapabilities.isError) && (
										<p role="alert" className="text-xs text-destructive">
											<Trans>
												This host does not support plain folders. Update the
												host and retry.
											</Trans>
										</p>
									)
								))}
							{error && (
								<p
									role="alert"
									className="select-text break-words text-xs text-destructive"
								>
									{error}
								</p>
							)}
							{status && (
								<output
									aria-live="polite"
									className="flex items-start gap-2 break-words text-xs text-muted-foreground"
								>
									{pending && (
										<LuLoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin" />
									)}
									{status}
								</output>
							)}
							{pending && kind === "template" && (
								<p className="text-xs text-muted-foreground">
									<Trans>
										Cancellation requests the target host to stop. Check the
										operation result before retrying at this location.
									</Trans>
								</p>
							)}
							<DialogFooter>
								<Button
									type="button"
									variant="ghost"
									onClick={close}
									disabled={pending && !cancellable}
								>
									{pending && cancellable ? (
										<Trans>Request cancellation</Trans>
									) : (
										<Trans>Cancel</Trans>
									)}
								</Button>
								{!gallery && (
									<Button
										type="submit"
										disabled={
											pending ||
											(kind === "folder" &&
												(!folderCapabilities.isSuccess ||
													folderCapabilities.isError ||
													!folderCapabilities.data?.folderProjects)) ||
											(!projectId &&
												!unresolved &&
												(kind === "folder"
													? !draft.repoPath.trim() || !draft.name.trim()
													: kind === "open"
														? !draft.repoPath.trim()
														: !draft.name.trim() ||
															!draft.parentDir.trim() ||
															(kind === "clone" && !draft.url.trim())))
										}
									>
										{pending ? (
											<Trans>Working…</Trans>
										) : projectId ? (
											<Trans>Continue opening</Trans>
										) : unresolved ? (
											<Trans>Check result</Trans>
										) : kind === "open" ? (
											<Trans>Open project</Trans>
										) : kind === "clone" ? (
											<Trans>Clone repository</Trans>
										) : (
											<Trans>Create project</Trans>
										)}
									</Button>
								)}
							</DialogFooter>
						</form>
					)}
				</DialogContent>
			</Dialog>
			{browse && (
				<HostDirectoryPicker
					context={session.context}
					initialPath={
						kind === "open" || kind === "folder"
							? draft.repoPath
							: draft.parentDir
					}
					onClose={() => setBrowse(false)}
					onSelect={(path) => {
						setBrowse(false);
						const next = {
							...session,
							draft: {
								...draft,
								[kind === "open" || kind === "folder"
									? "repoPath"
									: "parentDir"]: path,
								...(kind === "folder" && !draft.nameTouched
									? {
											name:
												path
													.replace(/[\\/]+$/, "")
													.split(/[\\/]/)
													.at(-1) ?? "",
										}
									: {}),
							},
						};
						update(next);
						if (kind === "open") void importPath(next, path);
					}}
				/>
			)}
		</>
	);
});
