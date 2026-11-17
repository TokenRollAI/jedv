import { cn } from "@jedv/ui/utils";
import type { ComponentProps } from "react";
export const FORM_PICKER_MENU_CLASS =
	"text-xs [&_[cmdk-input]]:text-xs [&_[cmdk-item]]:text-xs [&_[cmdk-item]]:rounded-md [&_[cmdk-empty]]:text-xs";
export function FormPickerTrigger({
	className,
	type = "button",
	...props
}: ComponentProps<"button">) {
	return (
		<button
			type={type}
			className={cn(
				"inline-flex h-7.5 min-w-0 items-center gap-1.5 rounded-lg border border-border/70 bg-secondary/55 px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
