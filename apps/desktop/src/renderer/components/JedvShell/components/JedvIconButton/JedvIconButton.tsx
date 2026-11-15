import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import type { ComponentProps } from "react";
export function JedvIconButton({
	label,
	children,
	...props
}: ComponentProps<"button"> & { label: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label={label}
					title={label}
					{...props}
					className={`grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${props.className ?? ""}`}
				>
					{children}
				</button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
