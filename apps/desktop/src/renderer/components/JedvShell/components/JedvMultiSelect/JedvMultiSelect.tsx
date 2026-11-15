import { Button } from "@jedv/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@jedv/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@jedv/ui/popover";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCheck, LuChevronDown } from "react-icons/lu";
import type { JedvSelectOption } from "../JedvSelect";
export function JedvMultiSelect({
	value,
	options,
	onValueChange,
	label,
	disabled,
	id,
}: {
	value: string[];
	options: JedvSelectOption[];
	onValueChange(value: string[]): void;
	label: string;
	disabled?: boolean;
	id?: string;
}) {
	const { t } = useLingui();
	const [open, setOpen] = useState(false);
	const summary = options
		.filter((option) => value.includes(option.value))
		.map((option) => option.label)
		.join(", ");
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					id={id}
					role="combobox"
					aria-expanded={open}
					aria-label={label}
					disabled={disabled}
					title={summary || t({ message: "Select an option" })}
					className="mt-1 h-7 w-full min-w-0 justify-between text-xs"
				>
					<span className="truncate">
						{summary || t({ message: "Select an option" })}
					</span>
					<LuChevronDown className="size-3 shrink-0" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-80 max-w-[calc(100vw-2rem)] p-0"
			>
				<Command>
					<CommandInput placeholder={t({ message: "Search" })} />
					<CommandList className="max-h-[min(16rem,var(--radix-popover-content-available-height))]">
						<CommandEmpty>{t({ message: "No results" })}</CommandEmpty>
						{options.map((option) => (
							<CommandItem
								key={option.value}
								value={`value:${option.value}`}
								keywords={[option.label]}
								title={option.label}
								onSelect={() =>
									onValueChange(
										value.includes(option.value)
											? value.filter((v) => v !== option.value)
											: options
													.filter(
														(o) =>
															o.value === option.value ||
															value.includes(o.value),
													)
													.map((o) => o.value),
									)
								}
							>
								<span className="min-w-0 flex-1 truncate text-xs">
									{option.label}
								</span>
								{value.includes(option.value) && (
									<LuCheck className="size-3.5" />
								)}
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
