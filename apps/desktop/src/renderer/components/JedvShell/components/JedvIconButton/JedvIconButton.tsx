import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { cn } from "@jedv/ui/utils";
import type { ComponentProps } from "react";

export function JedvIconButton({
	label,
	children,
	className,
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
					className={cn(
						"inline-flex size-7 shrink-0 items-center justify-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
						className,
					)}
				>
					{children}
				</button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
