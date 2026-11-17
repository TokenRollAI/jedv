import { Button } from "@jedv/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@jedv/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@jedv/ui/popover";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCheck, LuChevronDown, LuFolder, LuPlus } from "react-icons/lu";
import type { JedvParityViewContext } from "../../../../parity-types";
export function TaskWorkspacePicker({
	context,
	value,
	disabled,
	onChange,
}: {
	context: JedvParityViewContext;
	value: string;
	disabled: boolean;
	onChange(id: string): void;
}) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const rows = context.workspaces.filter((w) => w.archivedAt == null);
	const label = (workspace: (typeof rows)[number]) =>
		`${context.projects.find((p) => p.id === workspace.projectId)?.name ?? t({ message: "Session" })} / ${workspace.name || workspace.branch}`;
	const selected = rows.find((w) => w.id === value);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={disabled}
					role="combobox"
					aria-expanded={open}
					aria-label={t({ message: "Select workspace" })}
					title={
						selected ? label(selected) : t({ message: "Select workspace" })
					}
					className="h-8 max-w-[240px] gap-2 rounded-lg px-3 text-xs font-medium"
				>
					<LuFolder className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="truncate">
						{selected ? label(selected) : t({ message: "Select workspace" })}
					</span>
					<LuChevronDown className="size-3 shrink-0 opacity-65" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-80 max-w-[calc(100vw-2rem)] p-0"
			>
				<Command>
					<CommandInput placeholder={t({ message: "Search workspaces" })} />
					<CommandList className="max-h-[min(16rem,var(--radix-popover-content-available-height))]">
						<CommandEmpty>
							<Trans>No workspaces yet</Trans>
						</CommandEmpty>
						{rows.map((w) => (
							<CommandItem
								key={w.id}
								value={w.id}
								keywords={[label(w)]}
								onSelect={() => {
									onChange(w.id);
									setOpen(false);
								}}
							>
								<LuFolder className="size-3.5" />
								<span className="min-w-0 flex-1 truncate text-xs">
									{label(w)}
								</span>
								{w.id === value && <LuCheck className="size-3.5" />}
							</CommandItem>
						))}
					</CommandList>
					<div className="border-t p-1">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 w-full justify-start gap-2 text-xs"
							onClick={() => {
								setOpen(false);
								context.onOpenCreateWorkspace(selected?.projectId ?? undefined);
							}}
						>
							<LuPlus className="size-3.5" />
							<Trans>New Workspace</Trans>
						</Button>
					</div>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
