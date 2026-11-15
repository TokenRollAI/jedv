import { errorMessage } from "@jedv/i18n/errors";
import { resolveBranchPrefix } from "@jedv/shared/workspace-launch";
import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { JedvParityViewContext } from "../../../../parity-types";
import { ProjectSettingsSection } from "../ProjectSettingsSection/ProjectSettingsSection";
import { SettingRow } from "../SettingRow";
import { HostDirectoryPicker } from "./components/HostDirectoryPicker/HostDirectoryPicker";

type PrefixMode = "none" | "github" | "author" | "custom";
export function GitSettings(context: JedvParityViewContext) {
	const { client, hostUrl } = context;
	const { t } = useLingui();
	const [path, setPath] = useState("");
	const [mode, setMode] = useState<PrefixMode>("none");
	const [custom, setCustom] = useState("");
	const [pathDirty, setPathDirty] = useState(false);
	const [prefixDirty, setPrefixDirty] = useState(false);
	const [browsing, setBrowsing] = useState(false);
	const location = useQuery({
		queryKey: ["jedv-settings", hostUrl, "worktree-location-info"],
		queryFn: () => client.settings.worktreeLocation.get.query(),
	});
	const prefix = useQuery({
		queryKey: ["jedv-settings", hostUrl, "branch-prefix"],
		queryFn: () => client.settings.branchPrefix.get.query(),
	});
	const git = useQuery({
		queryKey: ["jedv-settings", hostUrl, "git-info"],
		queryFn: () => client.settings.branchPrefix.gitInfo.query(),
		enabled: mode === "github" || mode === "author",
		retry: false,
	});
	useEffect(() => {
		if (location.data && !pathDirty)
			setPath(location.data.worktreeBaseDir ?? "");
	}, [location.data, pathDirty]);
	useEffect(() => {
		if (prefix.data && !prefixDirty) {
			setMode(prefix.data.mode);
			setCustom(prefix.data.customPrefix ?? "");
		}
	}, [prefix.data, prefixDirty]);
	const savePath = useMutation({
		mutationFn: () =>
			client.settings.worktreeLocation.set.mutate({
				path: path.trim() || null,
			}),
		onSuccess: async () => {
			await location.refetch();
			setPathDirty(false);
		},
	});
	const savePrefix = useMutation({
		mutationFn: () =>
			client.settings.branchPrefix.set.mutate({
				mode,
				customPrefix: custom.trim() || null,
			}),
		onSuccess: async () => {
			await prefix.refetch();
			setPrefixDirty(false);
		},
	});
	const resolved = resolveBranchPrefix({
		mode,
		customPrefix: custom,
		authorPrefix: git.data?.authorName ?? null,
		githubUsername: git.data?.githubUsername ?? null,
	});
	const needsIdentity = mode === "author" || mode === "github";
	return (
		<div className="space-y-6">
			<div className="divide-y overflow-hidden rounded-lg border border-border">
				<SettingRow
					label={t({ message: "Worktree location" })}
					description={
						location.data
							? t({
									message: `New worktrees are stored here. Leave empty to use ${location.data.defaultWorktreeBaseDir}.`,
								})
							: t({
									message:
										"The default location for new worktrees on the connected host.",
								})
					}
					error={
						location.error || savePath.error
							? errorMessage(location.error ?? savePath.error)
							: undefined
					}
				>
					<div className="flex flex-wrap justify-end gap-2">
						<Input
							aria-label={t({ message: "Worktree location" })}
							className="h-8 w-64 max-w-full"
							value={path}
							disabled={!location.data || savePath.isPending}
							onChange={(event) => {
								setPath(event.target.value);
								setPathDirty(true);
							}}
						/>
						<Button
							size="sm"
							variant="outline"
							disabled={!location.data || savePath.isPending}
							onClick={() => setBrowsing(true)}
						>
							<Trans>Browse</Trans>
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={!location.data || savePath.isPending}
							onClick={() => {
								setPath("");
								setPathDirty(true);
							}}
						>
							<Trans>Reset</Trans>
						</Button>
						<Button
							size="sm"
							disabled={!pathDirty || savePath.isPending}
							onClick={() => savePath.mutate()}
						>
							<Trans>Save</Trans>
						</Button>
						{location.error && (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => void location.refetch()}
							>
								<Trans>Retry</Trans>
							</Button>
						)}
					</div>
				</SettingRow>
				<SettingRow
					label={t({ message: "Branch prefix" })}
					description={t({
						message:
							"Prefix new workspace branches on the connected host. Project overrides take priority.",
					})}
					error={
						prefix.error || savePrefix.error
							? errorMessage(prefix.error ?? savePrefix.error)
							: undefined
					}
				>
					<div className="flex flex-wrap justify-end gap-2">
						<Select
							value={mode}
							disabled={!prefix.data || savePrefix.isPending}
							onValueChange={(value) => {
								setMode(value as PrefixMode);
								setPrefixDirty(true);
							}}
						>
							<SelectTrigger
								className="w-44"
								size="sm"
								aria-label={t({ message: "Branch prefix" })}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(
									[
										{ value: "none", label: t({ message: "None" }) },
										{
											value: "github",
											label: t({ message: "GitHub username" }),
										},
										{ value: "author", label: t({ message: "Git author" }) },
										{ value: "custom", label: t({ message: "Custom" }) },
									] as const
								).map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							size="sm"
							disabled={!prefixDirty || savePrefix.isPending}
							onClick={() => savePrefix.mutate()}
						>
							<Trans>Save</Trans>
						</Button>
						{prefix.error && (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => void prefix.refetch()}
							>
								<Trans>Retry</Trans>
							</Button>
						)}
					</div>
				</SettingRow>
				{mode === "custom" && (
					<SettingRow label={t({ message: "Custom branch prefix" })}>
						<Input
							aria-label={t({ message: "Custom branch prefix" })}
							className="h-8 w-64"
							value={custom}
							disabled={savePrefix.isPending}
							onChange={(event) => {
								setCustom(event.target.value);
								setPrefixDirty(true);
							}}
						/>
					</SettingRow>
				)}
				<SettingRow
					label={t({ message: "Branch preview" })}
					description={
						needsIdentity
							? t({
									message:
										"Uses the connected host's global Git identity. GitHub mode may read your existing gh login.",
								})
							: undefined
					}
					error={git.error ? errorMessage(git.error) : undefined}
				>
					{needsIdentity && git.isPending ? (
						<span className="text-xs text-muted-foreground">
							<Trans>Loading identity…</Trans>
						</span>
					) : (
						<div className="text-right text-xs">
							<code className="break-all">
								{resolved ? `${resolved}/my-workspace` : "my-workspace"}
							</code>
							{needsIdentity && !resolved && (
								<p className="text-muted-foreground">
									<Trans>
										No prefix could be resolved from this host's identity.
									</Trans>
								</p>
							)}
						</div>
					)}
				</SettingRow>
				{browsing && (
					<HostDirectoryPicker
						client={client}
						hostUrl={hostUrl}
						initialPath={path || location.data?.defaultWorktreeBaseDir || ""}
						onClose={() => setBrowsing(false)}
						onChoose={(next) => {
							setPath(next);
							setPathDirty(true);
							setBrowsing(false);
						}}
					/>
				)}
			</div>
			<ProjectSettingsSection key={hostUrl} {...context} />
		</div>
	);
}
