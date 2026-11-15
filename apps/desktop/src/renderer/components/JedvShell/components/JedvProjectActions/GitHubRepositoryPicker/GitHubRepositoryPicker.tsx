import { Button } from "@jedv/ui/button";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@jedv/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@jedv/ui/popover";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { HiCheck } from "react-icons/hi2";
import { LuChevronsUpDown, LuGithub } from "react-icons/lu";
import type { ProjectActionContext } from "../types";

interface GitHubRepositoryPickerProps {
	disabled: boolean;
	context: ProjectActionContext;
	onSelect: (repository: { cloneUrl: string; fullName: string }) => void;
	selectedFullName: string | null;
}

export function GitHubRepositoryPicker({
	disabled,
	context,
	onSelect,
	selectedFullName,
}: GitHubRepositoryPickerProps) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const repositoriesQuery = useQuery({
		queryKey: ["jedv", context.hostUrl, "github-repositories"],
		queryFn: () => {
			return context.client.project.listGitHubRepositories.query();
		},
		enabled: open && !disabled,
		staleTime: 60_000,
		retry: false,
	});
	const repositories = repositoriesQuery.data ?? [];

	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-xs font-medium">
				<Trans>Repositories</Trans>
			</span>
			<Popover onOpenChange={setOpen} open={open}>
				<PopoverTrigger asChild>
					<Button
						className="justify-between font-normal"
						disabled={disabled}
						variant="outline"
					>
						{selectedFullName ? (
							<>
								<span className="flex min-w-0 items-center gap-2">
									<LuGithub className="size-4 shrink-0 text-muted-foreground" />
									<span className="truncate">{selectedFullName}</span>
								</span>
								<HiCheck className="size-4 shrink-0 text-muted-foreground" />
							</>
						) : (
							<>
								<span className="text-muted-foreground">
									<Trans>Select repositories</Trans>
								</span>
								<LuChevronsUpDown className="size-4 shrink-0 opacity-50" />
							</>
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					className="w-[var(--radix-popover-trigger-width)] p-0"
				>
					<Command>
						<CommandInput
							placeholder={t({ message: "Search repositories..." })}
						/>
						<CommandList className="max-h-64">
							<CommandEmpty>
								{repositoriesQuery.isLoading ? (
									<Trans>Loading repositories...</Trans>
								) : repositoriesQuery.isError ? (
									<Trans>
										Could not list repositories. Check gh authentication on the
										target host, or enter a URL below.
									</Trans>
								) : (
									<Trans>No matches</Trans>
								)}
							</CommandEmpty>
							{repositoriesQuery.isError && (
								<div className="px-3 pb-2">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => void repositoriesQuery.refetch()}
									>
										<Trans>Retry</Trans>
									</Button>
								</div>
							)}
							<CommandGroup>
								{repositories.map((repository) => {
									const selected = repository.fullName === selectedFullName;
									return (
										<CommandItem
											key={repository.fullName}
											onSelect={() => {
												onSelect(repository);
												setOpen(false);
											}}
											value={repository.fullName}
										>
											<LuGithub className="size-4 shrink-0 text-muted-foreground" />
											<span className="flex-1 truncate">
												{repository.fullName}
											</span>
											{selected && (
												<HiCheck className="size-4 shrink-0 text-muted-foreground" />
											)}
										</CommandItem>
									);
								})}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}
