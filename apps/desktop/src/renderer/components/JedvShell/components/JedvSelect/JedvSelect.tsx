import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@jedv/ui/select";
import { cn } from "@jedv/ui/utils";
import { useLingui } from "@lingui/react/macro";
export interface JedvSelectOption {
	value: string;
	label: string;
}
export function JedvSelect({
	value,
	options,
	onValueChange,
	label,
	placeholder,
	disabled,
	required,
	id,
	className,
}: {
	value: string;
	options: JedvSelectOption[];
	onValueChange(value: string): void;
	label: string;
	placeholder?: string;
	disabled?: boolean;
	required?: boolean;
	id?: string;
	className?: string;
}) {
	const { t } = useLingui();
	const selected = options.find((option) => option.value === value);
	const empty = placeholder ?? t({ message: "Select an option" });
	// Encoding makes the empty domain value safe for Radix, which reserves "" for its placeholder.
	return (
		<Select
			value={selected ? `value:${selected.value}` : ""}
			onValueChange={(encoded) => onValueChange(encoded.slice(6))}
			disabled={disabled}
			required={required}
		>
			<SelectTrigger
				id={id}
				aria-label={label}
				title={selected?.label ?? empty}
				className={cn(
					"data-[size=default]:h-auto min-h-7 min-w-0 max-w-full py-1 text-xs [&>span]:min-w-0 [&>span]:truncate",
					className,
				)}
			>
				<SelectValue placeholder={empty} />
			</SelectTrigger>
			<SelectContent
				position="popper"
				className="max-h-[min(20rem,var(--radix-select-content-available-height))] max-w-[min(28rem,calc(100vw-2rem))] overflow-y-auto"
			>
				{options.map((option) => (
					<SelectItem
						key={option.value}
						value={`value:${option.value}`}
						title={option.label}
						className="min-w-0 text-xs [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
					>
						<span className="block truncate">{option.label}</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
