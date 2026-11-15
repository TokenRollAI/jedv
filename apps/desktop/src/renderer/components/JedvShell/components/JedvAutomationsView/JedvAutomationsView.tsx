import { errorMessage } from "@jedv/i18n/errors";
import { formatCompactRelativeTime, formatDateTime } from "@jedv/i18n/format";
import { describeSchedule } from "@jedv/shared/rrule";
import { Button } from "@jedv/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Input } from "@jedv/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@jedv/ui/table";
import { cn } from "@jedv/ui/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	LuArrowLeft,
	LuClock,
	LuEllipsis,
	LuPlay,
	LuPlus,
	LuRefreshCw,
	LuSearch,
} from "react-icons/lu";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { JedvParityViewContext } from "../../parity-types";
import { AGENT_LABELS } from "../../types";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../JedvConfirmDialog/JedvConfirmDialog";
import {
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "../WindowChrome";
import { AutomationEditor } from "./components/AutomationEditor/AutomationEditor";
import { AutomationRuns } from "./components/AutomationRuns/AutomationRuns";
import type { Automation, AutomationInput } from "./types";
export function JedvAutomationsView(context: JedvParityViewContext) {
	const { client, hostUrl, projects, workspaces } = context;
	const { t } = useLingui();
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState("all");
	const [selected, setSelected] = useState<string | null>(null);
	const [tab, setTab] = useState("settings");
	const [dirty, setDirty] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const list = useQuery({
		queryKey: ["jedv", hostUrl, "automations"],
		queryFn: () => client.automations.list.query(),
		refetchInterval: 15000,
		retry: false,
	});
	const current = list.data?.find((a) => a.id === selected);
	const save = useMutation({
		mutationFn: async (input: AutomationInput) =>
			selected && selected !== "new"
				? client.automations.update.mutate({ id: selected, patch: input })
				: client.automations.create.mutate(input),
		onSuccess: async (automation) => {
			await list.refetch();
			setSelected(automation.id);
			setDirty(false);
			setNotice(t({ message: "Automation saved" }));
		},
	});
	const action = useMutation({
		mutationFn: async (input: {
			kind: "run" | "toggle" | "remove";
			automation: Automation;
		}) => {
			if (input.kind === "run")
				await client.automations.runNow.mutate({ id: input.automation.id });
			else if (input.kind === "toggle")
				await client.automations.setEnabled.mutate({
					id: input.automation.id,
					enabled: !input.automation.enabled,
				});
			else await client.automations.remove.mutate({ id: input.automation.id });
			return input;
		},
		onMutate: () => {
			setError(null);
			setNotice(null);
		},
		onSuccess: async ({ kind, automation }) => {
			await list.refetch();
			if (kind === "run") {
				setSelected(automation.id);
				setTab("runs");
				setNotice(t({ message: "Automation started" }));
			} else if (kind === "remove") {
				setSelected(null);
				setNotice(t({ message: "Automation deleted" }));
			} else
				setNotice(
					automation.enabled
						? t({ message: "Automation paused" })
						: t({ message: "Automation enabled" }),
				);
		},
		onError: (cause) =>
			setError(errorMessage(cause, t({ message: "Automation action failed" }))),
	});
	const navigate = (next: string | null, nextTab = "settings") => {
		const execute = () => {
			setSelected(next);
			setTab(nextTab);
			setDirty(false);
			setError(null);
			setNotice(null);
		};
		if (!dirty) execute();
		else
			setConfirmation({
				title: t({ message: "Discard unsaved changes?" }),
				description: t({
					message: "Your automation changes have not been saved.",
				}),
				detail: current?.name ?? t({ message: "New automation" }),
				execute: async () => execute(),
			});
	};
	const remove = (automation: Automation) =>
		setConfirmation({
			title: t({ message: "Delete automation?" }),
			description: t({
				message:
					"The definition and its run records will be deleted. Existing workspaces and sessions remain available.",
			}),
			detail: automation.name,
			execute: async () => {
				await action.mutateAsync({ kind: "remove", automation });
			},
		});
	const visible =
		list.data?.filter(
			(a) =>
				a.name.toLowerCase().includes(search.toLowerCase()) &&
				(filter === "all" || (filter === "active" ? a.enabled : !a.enabled)),
		) ?? [];
	return (
		<section
			className="flex h-full min-h-0 flex-col bg-background"
			aria-label={t({ message: "Automations" })}
		>
			<WindowChrome primary className="gap-2 border-b border-border pr-3">
				<WindowChromeLeading />
				<WindowChromeControls className="min-w-0 pl-3">
					<div className="flex min-w-0 items-center gap-2">
						{selected && (
							<Button
								size="icon"
								variant="ghost"
								className="size-7"
								onClick={() => navigate(null)}
								aria-label={t({ message: "Back to automations" })}
							>
								<LuArrowLeft className="size-4" />
							</Button>
						)}
						<h1 className="truncate text-lg font-semibold">
							{selected ? (
								(current?.name ??
								(selected === "new" ? (
									<Trans>New automation</Trans>
								) : (
									<Trans>Automation</Trans>
								)))
							) : (
								<Trans>Automations</Trans>
							)}
						</h1>
					</div>
				</WindowChromeControls>
				<div className="drag min-w-4 flex-1" />
				<WindowChromeControls className="jedv-chrome-toolbar">
					<div className="no-drag flex items-center gap-2">
						{!selected ? (
							<>
								<div className="relative w-56">
									<LuSearch className="absolute left-2 top-2 size-3.5 text-muted-foreground" />
									<Input
										className="h-8 border-none bg-muted/40 pl-7 text-xs"
										value={search}
										onChange={(e) => setSearch(e.target.value)}
										aria-label={t({ message: "Search automations" })}
										placeholder={t({ message: "Search automations…" })}
									/>
								</div>
								<Button size="sm" onClick={() => navigate("new")}>
									<LuPlus className="size-3.5" />
									<Trans>New automation</Trans>
								</Button>
							</>
						) : (
							current && (
								<Button
									size="sm"
									variant="outline"
									disabled={action.isPending || dirty}
									onClick={() =>
										action.mutate({ kind: "run", automation: current })
									}
								>
									<LuPlay className="size-3" />
									<Trans>Run now</Trans>
								</Button>
							)
						)}
					</div>
				</WindowChromeControls>
				<WindowControlsInset />
			</WindowChrome>
			{(error || list.error) && (
				<div
					role="alert"
					className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-6 py-2 text-xs text-destructive"
				>
					{error ??
						errorMessage(
							list.error,
							t({ message: "Failed to load automations" }),
						)}
					<Button
						size="sm"
						variant="ghost"
						className="h-6"
						onClick={() => {
							setError(null);
							void list.refetch();
						}}
					>
						<LuRefreshCw className="size-3" />
						<Trans>Refresh</Trans>
					</Button>
				</div>
			)}
			{notice && (
				<output className="border-b border-border px-6 py-2 text-xs text-muted-foreground">
					{notice}
				</output>
			)}
			{list.isPending && (
				<output className="px-6 py-4 text-xs text-muted-foreground">
					<Trans>Loading automations…</Trans>
				</output>
			)}
			{selected ? (
				<div className="min-h-0 flex-1 overflow-y-auto">
					{current || selected === "new" ? (
						<>
							<div className="mx-auto mt-5 flex w-full max-w-3xl items-center gap-1 px-8">
								{[
									{ id: "settings", label: t({ message: "Settings" }) },
									...(current
										? [{ id: "runs", label: t({ message: "Run History" }) }]
										: []),
								].map((item) => (
									<button
										key={item.id}
										type="button"
										onClick={() => setTab(item.id)}
										aria-pressed={tab === item.id}
										className={cn(
											"rounded-md px-3 py-1.5 text-sm transition-colors",
											tab === item.id
												? "bg-accent font-medium"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{item.label}
									</button>
								))}
							</div>
							<div className={tab === "settings" ? undefined : "hidden"}>
								<AutomationEditor
									key={selected}
									automation={current ?? null}
									projects={projects}
									workspaces={workspaces}
									pending={save.isPending}
									onSave={async (input) => {
										await save.mutateAsync(input);
									}}
									onDirty={setDirty}
								/>
							</div>
							{tab === "runs" && current && (
								<AutomationRuns
									client={client}
									hostUrl={hostUrl}
									automationId={current.id}
									onOpenWorkspace={context.onOpenWorkspace}
								/>
							)}
						</>
					) : (
						!list.isPending && (
							<p
								role="alert"
								className="px-8 py-6 text-sm text-muted-foreground"
							>
								<Trans>This automation is no longer available</Trans>
							</p>
						)
					)}
				</div>
			) : (
				<>
					<div className="flex shrink-0 items-center gap-1 border-b border-border px-6 py-2">
						{[
							{ id: "all", label: t({ message: "All" }) },
							{ id: "active", label: t({ message: "Active" }) },
							{ id: "paused", label: t({ message: "Paused" }) },
						].map((item) => (
							<button
								key={item.id}
								type="button"
								onClick={() => setFilter(item.id)}
								aria-pressed={filter === item.id}
								className={cn(
									"h-8 rounded-lg px-3 text-[13px]",
									filter === item.id
										? "bg-secondary font-medium"
										: "text-muted-foreground hover:bg-accent/60",
								)}
							>
								{item.label}
							</button>
						))}
					</div>
					<div className="min-h-0 flex-1 overflow-auto">
						{visible.length > 0 ? (
							<Table>
								<TableHeader>
									<TableRow className="hover:bg-transparent">
										<TableHead className="pl-6 text-xs">
											<Trans>Name</Trans>
										</TableHead>
										<TableHead className="text-xs">
											<Trans>Schedule</Trans>
										</TableHead>
										<TableHead className="text-xs">
											<Trans>Status</Trans>
										</TableHead>
										<TableHead className="text-xs">
											<Trans>Agent</Trans>
										</TableHead>
										<TableHead className="w-20">
											<span className="sr-only">
												<Trans>Actions</Trans>
											</span>
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{visible.map((automation) => {
										const project =
											automation.target.kind === "project"
												? projects.find(
														(p) =>
															p.id ===
															(automation.target.kind === "project"
																? automation.target.projectId
																: ""),
													)
												: null;
										return (
											<TableRow
												key={automation.id}
												className="group/row h-10 border-border/50 hover:bg-accent/50"
											>
												<TableCell className="pl-6">
													<button
														type="button"
														onClick={() => navigate(automation.id)}
														className="flex max-w-md items-center gap-2 text-left"
													>
														<span
															className={cn(
																"truncate text-sm font-medium",
																!automation.enabled && "text-muted-foreground",
															)}
														>
															{automation.name}
														</span>
														{project && (
															<span className="truncate text-xs text-muted-foreground">
																{project.name}
															</span>
														)}
													</button>
												</TableCell>
												<TableCell className="text-xs text-muted-foreground">
													{automation.rrule ? (
														describeSchedule(automation.rrule)
													) : (
														<Trans>Manual only</Trans>
													)}
												</TableCell>
												<TableCell
													title={
														automation.nextRunAt
															? formatDateTime(automation.nextRunAt)
															: undefined
													}
													className="text-xs text-muted-foreground"
												>
													{automation.enabled ? (
														<Trans>Active</Trans>
													) : (
														<Trans>Paused</Trans>
													)}
													{automation.enabled && automation.nextRunAt && (
														<span className="text-muted-foreground/60">
															{" "}
															·{" "}
															{formatCompactRelativeTime(automation.nextRunAt)}
														</span>
													)}
												</TableCell>
												<TableCell>
													<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
														<AgentIcon
															presetId={automation.agent}
															className="size-3.5"
														/>
														{AGENT_LABELS[automation.agent]}
													</span>
												</TableCell>
												<TableCell>
													<div className="flex justify-end gap-0.5">
														<Button
															size="icon"
															variant="ghost"
															className="size-7"
															disabled={action.isPending}
															onClick={() =>
																action.mutate({ kind: "run", automation })
															}
															aria-label={t({ message: "Run now" })}
														>
															<LuPlay className="size-3" />
														</Button>
														<DropdownMenu>
															<DropdownMenuTrigger asChild>
																<Button
																	size="icon"
																	variant="ghost"
																	className="size-7"
																	aria-label={t({
																		message: "Automation actions",
																	})}
																>
																	<LuEllipsis className="size-4" />
																</Button>
															</DropdownMenuTrigger>
															<DropdownMenuContent align="end">
																<DropdownMenuItem
																	onClick={() => navigate(automation.id)}
																>
																	<Trans>Edit</Trans>
																</DropdownMenuItem>
																<DropdownMenuItem
																	onClick={() =>
																		navigate(automation.id, "runs")
																	}
																>
																	<Trans>Run History</Trans>
																</DropdownMenuItem>
																<DropdownMenuItem
																	disabled={action.isPending}
																	onClick={() =>
																		action.mutate({
																			kind: "toggle",
																			automation,
																		})
																	}
																>
																	{automation.enabled ? (
																		<Trans>Pause</Trans>
																	) : (
																		<Trans>Enable</Trans>
																	)}
																</DropdownMenuItem>
																<DropdownMenuSeparator />
																<DropdownMenuItem
																	className="text-destructive"
																	disabled={action.isPending}
																	onClick={() => remove(automation)}
																>
																	<Trans>Delete</Trans>
																</DropdownMenuItem>
															</DropdownMenuContent>
														</DropdownMenu>
													</div>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						) : (
							!list.isPending &&
							!list.error && (
								<div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
									<LuClock className="size-8 text-muted-foreground/40" />
									<h2 className="text-sm font-medium">
										{search || filter !== "all" ? (
											<Trans>No automations match your filters</Trans>
										) : (
											<Trans>No automations yet</Trans>
										)}
									</h2>
									<p className="max-w-sm text-xs text-muted-foreground">
										<Trans>
											Run repeatable work with your local agents, on a schedule
											or when you need it.
										</Trans>
									</p>
									{!search && filter === "all" && (
										<Button
											size="sm"
											variant="outline"
											onClick={() => navigate("new")}
										>
											<LuPlus className="size-3.5" />
											<Trans>New automation</Trans>
										</Button>
									)}
								</div>
							)
						)}
					</div>
				</>
			)}
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</section>
	);
}
