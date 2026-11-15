import { errorMessage } from "@jedv/i18n/errors";
import { getPresetById } from "@jedv/shared/host-agent-presets";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@jedv/ui/alert-dialog";
import { Button } from "@jedv/ui/button";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AgentIcon } from "renderer/components/AgentIcon";
import {
	getAgentCommandText,
	parseAgentCommandText,
} from "renderer/lib/agent-launch-command";
import { joinArgs, parseArgs } from "renderer/lib/argv";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { syncLinkedPresetSnapshots } from "renderer/lib/linked-terminal-presets";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { LocalClient } from "../../../../local-client";
import { AsyncSetting } from "../AsyncSetting";

type Config = Awaited<
	ReturnType<LocalClient["settings"]["agentConfigs"]["list"]["query"]>
>[number];
export function AgentConfigEditor({
	client,
	hostUrl,
	local,
	config,
	onCreated,
	onDeleted,
}: {
	client: LocalClient;
	hostUrl: string;
	local: boolean;
	config: Config | null;
	onCreated(id: string): void;
	onDeleted(): void;
}) {
	const { t } = useLingui();
	const cache = useQueryClient();
	const presetUtils = electronTrpc.useUtils();
	const [label, setLabel] = useState(config?.label ?? "");
	const [command, setCommand] = useState(
		config ? getAgentCommandText(config) : "",
	);
	const [prompt, setPrompt] = useState(joinArgs(config?.promptArgs ?? []));
	const [resume, setResume] = useState(joinArgs(config?.resumeArgs ?? []));
	const [fork, setFork] = useState(joinArgs(config?.forkArgs ?? []));
	const [transport, setTransport] = useState<"argv" | "stdin">(
		config?.promptTransport ?? "argv",
	);
	const [env, setEnv] = useState(JSON.stringify(config?.env ?? {}, null, 2));
	const [validation, setValidation] = useState<string | null>(null);
	const refresh = async () => {
		await cache.invalidateQueries({
			queryKey: ["jedv-settings", hostUrl, "agent-configs"],
		});
		await cache.invalidateQueries({
			queryKey: ["jedv", hostUrl, "agent-configs"],
		});
	};
	const syncPresets = useMutation({
		mutationFn: async (id: string) => {
			if (!local) return;
			const [presets, configs] = await Promise.all([
				electronTrpcClient.settings.getTerminalPresets.query(),
				client.settings.agentConfigs.list.query(),
			]);
			const updated = configs.find((row) => row.id === id);
			if (!updated)
				throw new Error(t({ message: "Agent configuration unavailable" }));
			const patches = syncLinkedPresetSnapshots(presets, updated, configs, {
				remote: !local,
			});
			for (const input of patches) {
				await electronTrpcClient.settings.updateTerminalPreset.mutate(input);
			}
			if (patches.length) {
				const persisted =
					await electronTrpcClient.settings.getTerminalPresets.query();
				if (
					patches.some(({ id, patch }) => {
						const row = persisted.find((preset) => preset.id === id);
						return (
							row?.agentId !== patch.agentId ||
							JSON.stringify(row.commands) !== JSON.stringify(patch.commands)
						);
					})
				)
					throw new Error(
						t({
							message:
								"Preset association could not be confirmed. Refresh and try again.",
						}),
					);
			}
			await presetUtils.settings.getTerminalPresets.invalidate();
		},
	});
	const patch = useMutation({
		mutationFn: (
			change: Partial<
				Pick<
					Config,
					| "label"
					| "command"
					| "args"
					| "env"
					| "promptArgs"
					| "resumeArgs"
					| "forkArgs"
					| "promptTransport"
				>
			>,
		) => {
			if (!config) throw new Error("No agent selected");
			return client.settings.agentConfigs.update.mutate({
				id: config.id,
				patch: change,
			});
		},
		onSuccess: async (updated) => {
			await refresh();
			if (local) await syncPresets.mutateAsync(updated.id).catch(() => {});
		},
	});
	const create = useMutation({
		mutationFn: () => {
			const launch = parseAgentCommandText(command);
			return client.settings.agentConfigs.add.mutate({
				label: label.trim(),
				...launch,
				promptArgs: parseArgs(prompt),
				resumeArgs: parseArgs(resume),
				forkArgs: parseArgs(fork),
				promptTransport: transport,
				presetId: "custom",
				env: { ...launch.env, ...parseEnvironment(env) },
			});
		},
		onSuccess: async (result) => {
			await refresh();
			onCreated(result.id);
		},
	});
	const reset = useMutation({
		mutationFn: () => {
			if (!config) throw new Error("No agent selected");
			return client.settings.agentConfigs.restoreDefault.mutate({
				id: config.id,
			});
		},
		onSuccess: async (restored) => {
			setLabel(restored.label);
			setCommand(getAgentCommandText(restored));
			setPrompt(joinArgs(restored.promptArgs));
			setResume(joinArgs(restored.resumeArgs));
			setFork(joinArgs(restored.forkArgs));
			setTransport(restored.promptTransport);
			setEnv(JSON.stringify(restored.env, null, 2));
			setValidation(null);
			await refresh();
			if (local) await syncPresets.mutateAsync(restored.id).catch(() => {});
		},
	});
	const remove = useMutation({
		mutationFn: () => {
			if (!config) throw new Error("No agent selected");
			return client.settings.agentConfigs.remove.mutate({ id: config.id });
		},
		onSuccess: async () => {
			await refresh();
			onDeleted();
		},
	});
	const pending =
		patch.isPending ||
		create.isPending ||
		reset.isPending ||
		remove.isPending ||
		syncPresets.isPending;
	const parseEnvironment = (value: string): Record<string, string> => {
		const parsed: unknown = JSON.parse(value);
		if (
			!parsed ||
			typeof parsed !== "object" ||
			Array.isArray(parsed) ||
			Object.entries(parsed).some(
				([key, value]) =>
					!/^[_a-zA-Z][_a-zA-Z0-9]*$/.test(key) || typeof value !== "string",
			)
		)
			throw new Error(
				t({
					message:
						"Environment must be a JSON object with valid variable names and string values.",
				}),
			);
		return parsed as Record<string, string>;
	};
	const [invalidField, setInvalidField] = useState<string | null>(null);
	const save = () => {
		if (pending) return;
		try {
			setInvalidField("label");
			if (!label.trim())
				throw new Error(t({ message: "Enter an agent name." }));
			setInvalidField("command");
			const launch = parseAgentCommandText(command);
			if (!launch.command.trim())
				throw new Error(t({ message: "Enter a command." }));
			setInvalidField("env");
			const environment = { ...launch.env, ...parseEnvironment(env) };
			setInvalidField("promptArgs");
			const promptArgs = parseArgs(prompt);
			setInvalidField("resumeArgs");
			const resumeArgs = parseArgs(resume);
			setInvalidField("forkArgs");
			const forkArgs = parseArgs(fork);
			setInvalidField(null);
			setValidation(null);
			if (config)
				patch.mutate({
					label: label.trim(),
					command: launch.command,
					args: launch.args,
					env: environment,
					promptArgs,
					resumeArgs,
					forkArgs,
					promptTransport: transport,
				});
			else create.mutate();
		} catch (error) {
			setValidation(errorMessage(error));
		}
	};
	const error =
		validation ??
		(patch.error || create.error || reset.error || remove.error
			? errorMessage(patch.error ?? create.error ?? reset.error ?? remove.error)
			: null);
	const fields = [
		{
			key: "label" as const,
			label: t({ message: "Name" }),
			hint: "",
			value: label,
			set: setLabel,
		},
		{
			key: "command" as const,
			label: t({ message: "Command" }),
			hint: t({ message: "The command used to start this agent." }),
			value: command,
			set: setCommand,
		},
		{
			key: "promptArgs" as const,
			label: t({ message: "Prompt arguments" }),
			hint: t({ message: "Added only when launching with a prompt." }),
			value: prompt,
			set: setPrompt,
		},
		{
			key: "resumeArgs" as const,
			label: t({ message: "Resume arguments" }),
			hint: t({
				message:
					"Resume a native session. The session ID is appended after these arguments.",
			}),
			value: resume,
			set: setResume,
		},
		{
			key: "forkArgs" as const,
			label: t({ message: "Fork arguments" }),
			hint: t({
				message:
					"Create a separate session from an existing one. Use the session ID placeholder for its position.",
			}),
			value: fork,
			set: setFork,
		},
	];
	return (
		<div className="max-w-3xl space-y-6">
			<div className="flex items-center gap-3">
				<AgentIcon
					presetId={config?.presetId ?? "custom"}
					iconId={config?.iconId}
					className="size-7"
				/>
				<div>
					<h2 className="text-xl font-semibold">
						{config?.label ?? t({ message: "Add agent" })}
					</h2>
					<p className="mt-1 text-xs text-muted-foreground">
						<Trans>Commands and arguments for the connected host.</Trans>
					</p>
				</div>
			</div>
			{fields.map((field) => (
				<div key={field.key} className="space-y-1.5">
					<label htmlFor={`agent-${field.key}`} className="text-xs font-medium">
						{field.label}
					</label>
					{field.hint && (
						<p className="text-xs text-muted-foreground">{field.hint}</p>
					)}
					<Input
						id={`agent-${field.key}`}
						className="h-9 text-xs"
						value={field.value}
						disabled={pending}
						onChange={(event) => field.set(event.target.value)}
						aria-invalid={invalidField === field.key}
						onKeyDown={(event) => {
							if (event.key === "Enter") save();
						}}
					/>
				</div>
			))}
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium">
					<Trans>Prompt transport</Trans>
				</span>
				<Select
					value={transport}
					disabled={pending}
					onValueChange={(value) => {
						const next = value as "argv" | "stdin";
						setTransport(next);
					}}
				>
					<SelectTrigger
						size="sm"
						className="w-32"
						aria-label={t({ message: "Prompt transport" })}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="argv">argv</SelectItem>
						<SelectItem value="stdin">stdin</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<details className="text-xs">
				<summary className="cursor-pointer text-muted-foreground">
					<Trans>Environment variables</Trans>
				</summary>
				<p className="mt-2 text-xs text-muted-foreground">
					<Trans>
						Advanced environment values override variables written before the
						command.
					</Trans>
				</p>
				<Textarea
					aria-label={t({ message: "Environment variables" })}
					className="mt-2 min-h-24 font-mono text-xs"
					value={env}
					disabled={pending}
					onChange={(event) => setEnv(event.target.value)}
					aria-invalid={invalidField === "env"}
				/>
			</details>
			{local &&
				config &&
				["claude", "codex", "agy", "kimi"].includes(config.presetId) && (
					<div className="border-t">
						<AsyncSetting
							id={`hooks-${config.presetId}`}
							label={t({ message: "Session status and notifications" })}
							description={t({
								message:
									"Install lifecycle hooks for this agent on this device.",
							})}
							read={async () =>
								!(
									await electronTrpcClient.settings.getAgentHooksDisabled.query()
								).includes(config.presetId)
							}
							write={(enabled) =>
								electronTrpcClient.settings.setAgentHooksEnabled.mutate({
									agentId: config.presetId,
									enabled,
								})
							}
						/>
					</div>
				)}
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
			{syncPresets.error && (
				<div role="alert" className="space-y-1 text-xs text-destructive">
					<p>
						<Trans>Agent saved, but linked presets could not be updated.</Trans>
					</p>
					<p>{errorMessage(syncPresets.error)}</p>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={pending || !config || !local}
						onClick={() => {
							if (config && local) syncPresets.mutate(config.id);
						}}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			<output className="text-xs text-muted-foreground">
				{pending ? (
					<Trans>Saving…</Trans>
				) : config ? (
					<Trans>
						Save to apply your changes. Drafts are kept if saving fails.
					</Trans>
				) : null}
			</output>
			<div className="flex gap-2">
				{!config ? (
					<Button
						disabled={pending || !label.trim() || !command.trim()}
						onClick={save}
					>
						<Trans>Add agent</Trans>
					</Button>
				) : (
					<Button size="sm" disabled={pending} onClick={save}>
						<Trans>Save changes</Trans>
					</Button>
				)}
				{config &&
					(getPresetById(config.presetId) !== undefined ? (
						<Button
							variant="outline"
							size="sm"
							disabled={pending}
							onClick={() => reset.mutate()}
						>
							<Trans>Restore default</Trans>
						</Button>
					) : (
						<AlertDialog>
							<AlertDialogTrigger asChild>
								<Button variant="outline" size="sm" disabled={pending}>
									<Trans>Delete agent</Trans>
								</Button>
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>
										<Trans>Delete this custom agent?</Trans>
									</AlertDialogTitle>
									<AlertDialogDescription>
										<Trans>
											This removes its launch configuration. Existing sessions
											keep running.
										</Trans>
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel>
										<Trans>Cancel</Trans>
									</AlertDialogCancel>
									<AlertDialogAction onClick={() => remove.mutate()}>
										<Trans>Delete agent</Trans>
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					))}
			</div>
		</div>
	);
}
