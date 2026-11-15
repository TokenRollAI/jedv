import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@jedv/ui/command";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { LuFile, LuFolderGit2 } from "react-icons/lu";
import type { LocalClient } from "../../local-client";
import type { Workspace } from "../../types";
import { CommandActionItem } from "./components/CommandActionItem";
import { recentCommands, recentPaletteFiles, rememberCommand } from "./recent";

export interface JedvCommandAction {
	id: string;
	label: string;
	run(): void;
}
export function JedvCommandPalette({
	client,
	hostUrl,
	workspaceId,
	workspaces,
	actions,
	mode,
	onClose,
	onWorkspace,
	onFile,
}: {
	client: LocalClient;
	hostUrl: string;
	workspaceId: string | null;
	workspaces: Workspace[];
	actions: JedvCommandAction[];
	mode: "commands" | "files";
	onClose(): void;
	onWorkspace(id: string): void;
	onFile(path: string): void;
}) {
	const { t } = useLingui();
	const [query, setQuery] = useState("");
	const [search, setSearch] = useState("");
	useEffect(() => {
		const timer = setTimeout(() => setSearch(query.trim()), 150);
		return () => clearTimeout(timer);
	}, [query]);
	const files = useQuery({
		queryKey: ["jedv", hostUrl, workspaceId, "quick-open", search],
		queryFn: () =>
			client.filesystem.searchFiles.query({
				workspaceId: workspaceId ?? undefined,
				query: search,
				limit: 40,
			}),
		enabled: !!workspaceId && search.length > 0,
		retry: false,
	});
	const choose = (run: () => void) => {
		onClose();
		run();
	};
	const filter = (label: string) =>
		label.toLowerCase().includes(query.toLowerCase());
	return (
		<CommandDialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={t({ message: "Open Command Palette" })}
			description={t({ message: "Search" })}
		>
			<CommandInput
				value={query}
				onValueChange={setQuery}
				placeholder={
					mode === "files"
						? t({ message: "Search files..." })
						: t({ message: "Search" })
				}
			/>
			<CommandList>
				<CommandEmpty>
					{files.error
						? files.error.message
						: t({ message: "No results found." })}
				</CommandEmpty>
				{!query && recentCommands().length > 0 && mode === "commands" && (
					<CommandGroup heading={t({ message: "Recent" })}>
						{recentCommands().flatMap((id) => {
							const action = actions.find((item) => item.id === id);
							return action
								? [
										<CommandActionItem
											key={id}
											action={action}
											onChoose={() => {
												rememberCommand(id);
												choose(action.run);
											}}
										/>,
									]
								: [];
						})}
					</CommandGroup>
				)}
				{!query && recentPaletteFiles(hostUrl, workspaceId).length > 0 && (
					<CommandGroup heading={t({ message: "Recent files" })}>
						{recentPaletteFiles(hostUrl, workspaceId).map((file) => (
							<CommandItem
								key={file.path}
								value={file.path}
								onSelect={() => choose(() => onFile(file.path))}
							>
								<LuFile className="size-4" />
								<span className="truncate">{file.path}</span>
							</CommandItem>
						))}
					</CommandGroup>
				)}
				{mode === "commands" && (
					<CommandGroup heading={t({ message: "Commands" })}>
						{actions
							.filter((a) => filter(a.label))
							.map((action) => (
								<CommandActionItem
									key={action.id}
									action={action}
									onChoose={() => {
										rememberCommand(action.id);
										choose(action.run);
									}}
								/>
							))}
					</CommandGroup>
				)}
				{mode === "commands" && (
					<CommandGroup heading={t({ message: "Workspaces" })}>
						{workspaces
							.filter((w) => filter(`${w.name} ${w.branch}`))
							.slice(0, 40)
							.map((w) => (
								<CommandItem
									key={w.id}
									value={`${w.id} ${w.name} ${w.branch}`}
									onSelect={() => choose(() => onWorkspace(w.id))}
								>
									<LuFolderGit2 className="size-4" />
									{w.name || w.branch}
								</CommandItem>
							))}
					</CommandGroup>
				)}
				<CommandGroup heading={t({ message: "Files" })}>
					{files.data?.matches.map((file) => (
						<CommandItem
							key={file.relativePath}
							value={`${query} ${file.relativePath}`}
							onSelect={() => choose(() => onFile(file.relativePath))}
						>
							<LuFile className="size-4" />
							<span className="truncate">{file.relativePath}</span>
						</CommandItem>
					))}
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}
