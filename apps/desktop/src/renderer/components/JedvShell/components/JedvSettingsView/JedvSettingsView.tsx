import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
	ArrowLeft,
	Bell,
	ChartNoAxesColumn,
	Code2,
	FolderGit2,
	GitBranch,
	Keyboard,
	Monitor,
	Network,
	Palette,
	Search,
	Settings2,
	Shield,
	Terminal,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
	JedvParityViewContext,
	JedvSettingsSection,
} from "../../parity-types";
import { JedvUsageView } from "../JedvUsageView";
import {
	WindowChrome,
	WindowChromeLeading,
	WindowControlsInset,
} from "../WindowChrome";
import { AgentSettings } from "./components/AgentSettings/AgentSettings";
import { AppearanceSettings } from "./components/AppearanceSettings/AppearanceSettings";

import { ConnectionSettings } from "./components/ConnectionSettings/ConnectionSettings";
import { GitSettings } from "./components/GitSettings/GitSettings";
import { KeyboardSettings } from "./components/KeyboardSettings/KeyboardSettings";
import { LocalSettings } from "./components/LocalSettings/LocalSettings";
import { NotificationSettings } from "./components/NotificationSettings/NotificationSettings";
import { PermissionsSettings } from "./components/PermissionsSettings/PermissionsSettings";
import { ProjectSettingsSection } from "./components/ProjectSettingsSection/ProjectSettingsSection";
import { SettingsSearchContext } from "./hooks/useSettingsSearch";
import {
	getVisibleMatchCountBySection,
	SETTINGS_SEARCH_ITEMS,
} from "./utils/settings-search";
export interface JedvSettingsViewProps extends JedvParityViewContext {
	initialSection?: JedvSettingsSection;
	onBack?(): void;
}
const sections = [
	{
		id: "appearance",
		label: msg({ message: "Appearance" }),
		description: msg({ message: "Customize how Jedv looks on your device" }),
		icon: Palette,
		words:
			"theme fonts typography language markdown light dark system agent activity menu bar",
	},
	{
		id: "notifications",
		label: msg({ message: "Notifications" }),
		description: msg({ message: "Choose notification sounds and volume." }),
		icon: Bell,
		words: "sound ringtone mute volume",
	},
	{
		id: "usage",
		label: msg({ message: "Usage" }),
		description: msg({ message: "Local CLI history and provider quota." }),
		icon: ChartNoAxesColumn,
		words: "quota cost tokens history",
	},
	{
		id: "connection",
		label: msg({ message: "Private connection" }),
		description: msg({ message: "Manage the host used by your workspaces." }),
		icon: Network,
		words: "tailscale host remote connection",
	},
	{
		id: "general",
		label: msg({ message: "General" }),
		description: msg({ message: "Choose how Jedv behaves on this device." }),
		icon: Settings2,
		words:
			"quit resource monitor sidebar version update release permission disk accessibility microphone automation network projects recently deleted restore experimental",
	},
	{
		id: "keyboard",
		label: msg({ message: "Keyboard" }),
		description: msg({
			message: "Customize shortcuts for your local workflow.",
		}),
		icon: Keyboard,
		words: "hotkey keybinding shortcut layout",
	},
	{
		id: "git",
		label: msg({ message: "Git & worktree" }),
		description: msg({
			message: "Defaults for new workspaces on the connected host.",
		}),
		icon: GitBranch,
		words: "git worktree branch prefix location",
	},
	{
		id: "agents",
		label: msg({ message: "Agent commands" }),
		description: msg({
			message: "Configure agent commands for the connected host.",
		}),
		icon: Monitor,
		words:
			"claude codex antigravity agy kimi command prompt resume fork custom env",
	},
	{
		id: "terminal",
		label: msg({ message: "Terminal" }),
		description: msg({
			message: "Customize terminal behavior and typography.",
		}),
		icon: Terminal,
		words:
			"copy select links cursor terminal fonts confirm close cache presets scripts daemon diagnostics sessions pid size status",
	},
	{
		id: "files",
		label: msg({ message: "Files & editor" }),
		description: msg({
			message: "Choose file and editor behavior on this device.",
		}),
		icon: Code2,
		words: "files editor save autosave font",
	},

	{
		id: "projects",
		label: msg({ message: "Projects" }),
		description: msg({
			message: "Manage local projects and recently deleted projects.",
		}),
		icon: FolderGit2,
		words: "project repository worktree recently deleted restore",
	},
	{
		id: "permissions",
		label: msg({ message: "Permissions" }),
		description: msg({ message: "Review system permissions on this device." }),
		icon: Shield,
		words: "permission disk accessibility microphone automation network",
	},
] as const;
export function JedvSettingsView({
	initialSection = "agents",
	onBack,
	...context
}: JedvSettingsViewProps) {
	const { t, i18n } = useLingui();
	const [section, setSection] = useState<JedvSettingsSection>(initialSection);
	const [query, setQuery] = useState("");
	useEffect(() => setSection(initialSection), [initialSection]);
	const sectionMatches = (id: JedvSettingsSection, value: string) => {
		const item = sections.find((section) => section.id === id);
		return (
			!!item &&
			`${i18n._(item.label)} ${i18n._(item.description)}`
				.toLocaleLowerCase()
				.includes(value.trim().toLocaleLowerCase())
		);
	};
	const getCounts = (value: string) => {
		const counts = getVisibleMatchCountBySection(value, (message) =>
			i18n._(message),
		);
		for (const item of sections)
			if (value.trim() && sectionMatches(item.id, value))
				counts[item.id] = SETTINGS_SEARCH_ITEMS.filter(
					(entry) => entry.section === item.id,
				).length;
		return counts;
	};
	const matchCounts = getCounts(query);
	const searchInput = useRef<HTMLInputElement>(null);
	const visible = sections.filter(
		(item) => !query.trim() || (matchCounts[item.id] ?? 0) > 0,
	);

	const current =
		sections.find((item) => item.id === section) ??
		sections.find((item) => item.id === "agents") ??
		sections[0];
	const search = i18n
		._(current.label)
		.toLocaleLowerCase()
		.includes(query.toLocaleLowerCase())
		? ""
		: query;
	return (
		<SettingsSearchContext value={search}>
			<div className="flex h-full min-h-0 min-w-0 bg-background text-foreground">
				<aside className="jedv-settings-sidebar flex w-56 min-h-0 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar">
					<WindowChrome>
						<WindowChromeLeading leftmost expand={false} />
						<div className="drag min-w-4 flex-1" />
					</WindowChrome>
					<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4 pt-2">
						{onBack && (
							<Button
								variant="ghost"
								size="sm"
								className="justify-start mb-3"
								onClick={onBack}
							>
								<ArrowLeft className="size-3.5" />
								<Trans>Back</Trans>
							</Button>
						)}
						<h1 className="mb-2 text-lg font-semibold">
							<Trans>Settings</Trans>
						</h1>
						<div className="relative mb-4">
							<Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
							<Input
								ref={searchInput}
								className="h-8 pl-8 pr-8 text-xs"
								aria-label={t({ message: "Search settings" })}
								placeholder={t({ message: "Search settings…" })}
								value={query}
								onChange={(event) => {
									const next = event.target.value;
									setQuery(next);
									if (next) {
										const counts = getCounts(next);
										const first = sections.find(
											(item) => (counts[item.id] ?? 0) > 0,
										);
										if (first) setSection(first.id);
									}
								}}
							/>
							{query && (
								<button
									type="button"
									aria-label={t({ message: "Clear search" })}
									className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
									onClick={() => {
										setQuery("");
										searchInput.current?.focus();
									}}
								>
									<X className="size-3" />
								</button>
							)}
						</div>
						<nav aria-label={t({ message: "Settings sections" })}>
							{[0, 1]
								.filter((group) =>
									visible.some((item) =>
										sections.indexOf(item) < 4 ? group === 0 : group === 1,
									),
								)
								.map((group) => (
									<div className="mb-5" key={group}>
										<h2 className="px-2.5 mb-2 text-[11px] text-muted-foreground">
											{group === 0 ? (
												<Trans>Personal</Trans>
											) : (
												<Trans>Editor & workflow</Trans>
											)}
										</h2>
										<div className="space-y-1">
											{visible
												.filter((item) =>
													sections.indexOf(item) < 4
														? group === 0
														: group === 1,
												)
												.map((item) => {
													const Icon = item.icon;
													return (
														<button
															type="button"
															key={item.id}
															aria-current={
																section === item.id ? "page" : undefined
															}
															className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent ${section === item.id ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
															onClick={() => setSection(item.id)}
														>
															<Icon className="size-3.5 shrink-0" />
															{i18n._(item.label)}
															{query.trim() && (
																<span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
																	{matchCounts[item.id]}
																</span>
															)}
														</button>
													);
												})}
										</div>
									</div>
								))}
						</nav>
						{visible.length === 0 && (
							<output className="px-2 text-xs text-muted-foreground">
								<Trans>No matching settings.</Trans>
							</output>
						)}
					</div>
				</aside>
				<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
					<WindowChrome primary className="border-b border-border/40">
						<div className="drag min-w-4 flex-1" />
						<WindowControlsInset />
					</WindowChrome>
					<main
						data-settings-section={section}
						className="jedv-settings-content min-h-0 min-w-0 flex-1 overflow-auto pb-10"
						key={section}
					>
						{query.trim() && visible.length === 0 ? (
							<output className="block p-6 text-sm text-muted-foreground">
								<Trans>No matching settings.</Trans>
							</output>
						) : section === "agents" ? (
							<AgentSettings {...context} />
						) : section === "usage" ? (
							<JedvUsageView {...context} />
						) : (
							<div className="mx-auto w-full max-w-5xl p-6">
								<header className="mb-8">
									<h2 className="text-xl font-semibold">
										{i18n._(current.label)}
									</h2>
									<p className="mt-1 text-sm text-muted-foreground">
										{i18n._(current.description)}
									</p>
								</header>
								{section === "projects" ? (
									<ProjectSettingsSection {...context} />
								) : section === "permissions" ? (
									<PermissionsSettings />
								) : section === "appearance" ? (
									<AppearanceSettings />
								) : section === "notifications" ? (
									<NotificationSettings />
								) : section === "connection" ? (
									<ConnectionSettings {...context} />
								) : section === "keyboard" ? (
									<KeyboardSettings />
								) : section === "git" ? (
									<GitSettings key={context.hostUrl} {...context} />
								) : (
									<LocalSettings section={section} context={context} />
								)}
							</div>
						)}
					</main>
				</div>
			</div>
		</SettingsSearchContext>
	);
}
