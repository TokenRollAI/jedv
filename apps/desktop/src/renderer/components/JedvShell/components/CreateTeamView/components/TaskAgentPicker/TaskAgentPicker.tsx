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
import { LuBot, LuCheck, LuChevronDown } from "react-icons/lu";
import { AgentIcon } from "renderer/components/AgentIcon";
import type { HostAgentConfig } from "../../../../types";
export function TaskAgentPicker({
	agents,
	value,
	disabled,
	onChange,
}: {
	agents: HostAgentConfig[];
	value: string;
	disabled: boolean;
	onChange(id: string): void;
}) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const selected = agents.find((a) => a.id === value);
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
					aria-label={t({ message: "Agent" })}
					title={selected?.label ?? t({ message: "Agent" })}
					className="h-8 max-w-44 gap-1.5 px-2 text-xs"
				>
					{selected ? (
						<AgentIcon
							presetId={selected.presetId}
							iconId={selected.iconId}
							className="size-4"
						/>
					) : (
						<LuBot className="size-4" />
					)}
					<span className="truncate">
						{selected?.label ?? t({ message: "Agent" })}
					</span>
					<LuChevronDown className="size-3 shrink-0" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-64 max-w-[calc(100vw-2rem)] p-0"
			>
				<Command>
					<CommandInput placeholder={t({ message: "Search agents…" })} />
					<CommandList className="max-h-[min(16rem,var(--radix-popover-content-available-height))]">
						<CommandEmpty>
							<Trans>No agents configured</Trans>
						</CommandEmpty>
						{agents.map((agent) => (
							<CommandItem
								key={agent.id}
								value={agent.id}
								keywords={[agent.label, agent.presetId]}
								onSelect={() => {
									onChange(agent.id);
									setOpen(false);
								}}
							>
								<AgentIcon
									presetId={agent.presetId}
									iconId={agent.iconId}
									className="size-4"
								/>
								<span className="min-w-0 flex-1 truncate text-xs">
									{agent.label}
								</span>
								{agent.id === value && <LuCheck className="size-3.5" />}
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
