import { errorMessage } from "@jedv/i18n/errors";
import { formatDateTime } from "@jedv/i18n/format";
import {
	buildRrule,
	matchPreset,
	parseRrule,
	type Weekday,
} from "@jedv/shared/rrule";
import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Switch } from "@jedv/ui/switch";
import { Textarea } from "@jedv/ui/textarea";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { JedvParityViewContext } from "../../../../parity-types";
import {
	AGENT_LABELS,
	NATIVE_PROVIDERS,
	type NativeProvider,
} from "../../../../types";
import type { Automation, AutomationInput } from "../../types";
export function AutomationEditor({
	automation,
	projects,
	workspaces,
	pending,
	onSave,
	onDirty,
}: {
	automation: Automation | null;
	projects: JedvParityViewContext["projects"];
	workspaces: JedvParityViewContext["workspaces"];
	pending: boolean;
	onSave(input: AutomationInput): Promise<void>;
	onDirty(dirty: boolean): void;
}) {
	const { t } = useLingui();
	const [name, setName] = useState(automation?.name ?? "");
	const [prompt, setPrompt] = useState(automation?.prompt ?? "");
	const [agent, setAgent] = useState<NativeProvider>(
		automation?.agent ?? "claude",
	);
	const [target, setTarget] = useState(
		automation
			? automation.target.kind === "workspace"
				? `workspace:${automation.target.workspaceId}`
				: `project:${automation.target.projectId}`
			: projects[0]
				? `project:${projects[0].id}`
				: "",
	);
	const [baseBranch, setBaseBranch] = useState(
		automation?.target.kind === "project"
			? (automation.target.baseBranch ?? "")
			: "",
	);
	const [enabled, setEnabled] = useState(automation?.enabled ?? false);
	const preset = automation?.rrule ? matchPreset(automation.rrule) : null;
	const [schedule, setSchedule] = useState(preset?.kind ?? "manual");
	const [time, setTime] = useState(
		preset && (preset.kind === "daily" || preset.kind === "weekly")
			? `${String(preset.hour).padStart(2, "0")}:${String(preset.minute).padStart(2, "0")}`
			: "09:00",
	);
	const [day, setDay] = useState<Weekday>(
		preset?.kind === "weekly" ? preset.day : "MO",
	);
	const [custom, setCustom] = useState(automation?.rrule ?? "");
	const [timezone, setTimezone] = useState(
		automation?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
	);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const edit = (update: () => void) => {
		update();
		onDirty(true);
		setSaved(false);
		setError(null);
	};
	let rrule: string | null = null;
	let scheduleError: string | null = null;
	let next: Date | null = null;
	try {
		const [hour, minute] = time.split(":").map(Number);
		rrule =
			schedule === "manual"
				? null
				: schedule === "hourly"
					? buildRrule({ kind: "hourly" })
					: schedule === "daily"
						? buildRrule({
								kind: "daily",
								hour: hour ?? 9,
								minute: minute ?? 0,
							})
						: schedule === "weekly"
							? buildRrule({
									kind: "weekly",
									hour: hour ?? 9,
									minute: minute ?? 0,
									day,
								})
							: custom.trim();
		if (rrule)
			next = parseRrule({ rrule, timezone, dtstart: new Date() }).nextRunAt;
	} catch (cause) {
		scheduleError = errorMessage(
			cause,
			t({ message: "Enter a valid schedule and time zone" }),
		);
	}
	const missingTarget =
		!projects.some((p) => target === `project:${p.id}`) &&
		!workspaces.some(
			(w) => target === `workspace:${w.id}` && w.archivedAt == null,
		);
	return (
		<form
			onSubmit={async (event) => {
				event.preventDefault();
				setError(null);
				try {
					if (scheduleError) throw new Error(scheduleError);
					const [kind, id] = target.split(":");
					if (!id || missingTarget)
						throw new Error(
							t({ message: "Choose an available project or workspace" }),
						);
					await onSave({
						name: name.trim(),
						prompt: prompt.trim(),
						agent,
						...(automation?.agentConfigId && automation.agent === agent
							? { agentConfigId: automation.agentConfigId }
							: {}),
						enabled,
						rrule,
						timezone,
						target:
							kind === "workspace"
								? { kind: "workspace", workspaceId: id }
								: {
										kind: "project",
										projectId: id,
										...(baseBranch.trim()
											? { baseBranch: baseBranch.trim() }
											: {}),
									},
					});
					onDirty(false);
					setSaved(true);
				} catch (cause) {
					setError(
						errorMessage(cause, t({ message: "Failed to save automation" })),
					);
				}
			}}
			className="mx-auto flex w-full max-w-3xl flex-col px-8 py-6"
		>
			<fieldset disabled={pending} className="contents">
				<Input
					aria-label={t({ message: "Automation name" })}
					placeholder={t({ message: "Untitled automation" })}
					value={name}
					maxLength={200}
					required
					onChange={(e) => edit(() => setName(e.target.value))}
					className="h-11 border-transparent bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
				/>
				<div className="mb-6 mt-3 flex items-center gap-2 text-sm">
					<Switch
						id="automation-enabled"
						checked={enabled}
						onCheckedChange={(value) => edit(() => setEnabled(value))}
					/>
					<label htmlFor="automation-enabled">
						{enabled ? <Trans>Active</Trans> : <Trans>Paused</Trans>}
					</label>
				</div>
				<div className="rounded-xl border border-border bg-card/40 p-4">
					<h2 className="mb-4 text-sm font-medium">
						<Trans>Triggers</Trans>
					</h2>
					<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span>
							<Trans>Run</Trans>
						</span>
						<Select
							value={schedule}
							onValueChange={(value) => edit(() => setSchedule(value))}
						>
							<SelectTrigger className="h-7 w-auto gap-2 rounded-md bg-muted/50 px-2 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="manual">
									<Trans>Manually</Trans>
								</SelectItem>
								<SelectItem value="hourly">
									<Trans>Hourly</Trans>
								</SelectItem>
								<SelectItem value="daily">
									<Trans>Daily</Trans>
								</SelectItem>
								<SelectItem value="weekly">
									<Trans>Weekly</Trans>
								</SelectItem>
								<SelectItem value="custom">
									<Trans>Custom</Trans>
								</SelectItem>
							</SelectContent>
						</Select>
						{(schedule === "daily" || schedule === "weekly") && (
							<Input
								type="time"
								aria-label={t({ message: "Run time" })}
								value={time}
								required
								onChange={(e) => edit(() => setTime(e.target.value))}
								className="h-7 w-28 text-xs"
							/>
						)}
						{schedule === "weekly" && (
							<Select
								value={day}
								onValueChange={(value) => edit(() => setDay(value as Weekday))}
							>
								<SelectTrigger className="h-7 w-32 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[
										{ value: "MO", label: t({ message: "Monday" }) },
										{ value: "TU", label: t({ message: "Tuesday" }) },
										{ value: "WE", label: t({ message: "Wednesday" }) },
										{ value: "TH", label: t({ message: "Thursday" }) },
										{ value: "FR", label: t({ message: "Friday" }) },
										{ value: "SA", label: t({ message: "Saturday" }) },
										{ value: "SU", label: t({ message: "Sunday" }) },
									].map((d) => (
										<SelectItem key={d.value} value={d.value}>
											{d.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
						{schedule !== "manual" && (
							<Input
								value={timezone}
								required
								aria-label={t({ message: "Time zone" })}
								placeholder="America/Los_Angeles"
								onChange={(e) => edit(() => setTimezone(e.target.value))}
								className="h-7 w-48 text-xs"
							/>
						)}
					</div>
					{schedule === "custom" && (
						<Input
							className="mt-3 h-8 font-mono text-xs"
							aria-label={t({ message: "Recurrence rule" })}
							placeholder="FREQ=DAILY;BYHOUR=9;BYMINUTE=0"
							required
							value={custom}
							onChange={(e) => edit(() => setCustom(e.target.value))}
						/>
					)}
					{scheduleError && (
						<p role="alert" className="mt-2 text-xs text-destructive">
							{scheduleError}
						</p>
					)}
					{next && (
						<p className="mt-2 text-xs text-muted-foreground">
							<Trans>
								Next scheduled time:{" "}
								{formatDateTime(next, {
									dateStyle: "medium",
									timeStyle: "short",
									timeZone: timezone,
								})}
							</Trans>
						</p>
					)}
					<div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
						<span>
							<Trans>In</Trans>
						</span>
						<Select
							value={target}
							onValueChange={(value) => edit(() => setTarget(value))}
						>
							<SelectTrigger
								className="h-7 max-w-full w-72 bg-muted/50 text-xs"
								aria-label={t({ message: "Run target" })}
							>
								<SelectValue
									placeholder={t({ message: "Choose a project or workspace" })}
								/>
							</SelectTrigger>
							<SelectContent>
								{projects.map((p) => (
									<SelectItem key={p.id} value={`project:${p.id}`}>
										{p.name} · {t({ message: "New worktree each run" })}
									</SelectItem>
								))}
								{workspaces
									.filter((w) => w.archivedAt == null)
									.map((w) => (
										<SelectItem key={w.id} value={`workspace:${w.id}`}>
											{w.name || w.branch}
										</SelectItem>
									))}
							</SelectContent>
						</Select>
					</div>
					{target.startsWith("project:") && (
						<Input
							className="mt-3 h-8 text-xs"
							aria-label={t({ message: "Base branch" })}
							placeholder={t({ message: "Base branch (repository default)" })}
							value={baseBranch}
							onChange={(e) => edit(() => setBaseBranch(e.target.value))}
						/>
					)}
					{missingTarget && (
						<p role="alert" className="mt-2 text-xs text-destructive">
							<Trans>Choose an available project or workspace</Trans>
						</p>
					)}
				</div>
				<label
					htmlFor="automation-prompt"
					className="mb-2 mt-8 text-sm text-muted-foreground"
				>
					<Trans>Instructions</Trans>
				</label>
				<div className="flex flex-col rounded-xl border border-border bg-card/40">
					<Textarea
						id="automation-prompt"
						required
						value={prompt}
						maxLength={100000}
						placeholder={t({ message: "Describe what the agent should do…" })}
						onChange={(e) => edit(() => setPrompt(e.target.value))}
						className="min-h-[240px] resize-y border-none bg-transparent px-4 py-3 text-sm shadow-none focus-visible:ring-0"
					/>
					<div className="flex items-center p-2.5">
						<Select
							value={agent}
							onValueChange={(value) =>
								edit(() => setAgent(value as NativeProvider))
							}
						>
							<SelectTrigger
								className="h-7 w-auto gap-2 border-none bg-muted/50 text-xs"
								aria-label={t({ message: "Agent" })}
							>
								<AgentIcon presetId={agent} className="size-3.5" />
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{NATIVE_PROVIDERS.map((p) => (
									<SelectItem key={p} value={p}>
										{AGENT_LABELS[p]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
				{error && (
					<p
						role="alert"
						className="mt-3 whitespace-pre-wrap text-xs text-destructive"
					>
						{error}
					</p>
				)}
				{saved && (
					<output className="mt-3 text-xs text-emerald-600">
						<Trans>Automation saved</Trans>
					</output>
				)}
				<div className="mt-4 flex justify-end">
					<Button
						size="sm"
						disabled={
							pending ||
							!!scheduleError ||
							missingTarget ||
							!name.trim() ||
							!prompt.trim()
						}
						type="submit"
					>
						{pending ? <Trans>Saving…</Trans> : <Trans>Save changes</Trans>}
					</Button>
				</div>
			</fieldset>
		</form>
	);
}
