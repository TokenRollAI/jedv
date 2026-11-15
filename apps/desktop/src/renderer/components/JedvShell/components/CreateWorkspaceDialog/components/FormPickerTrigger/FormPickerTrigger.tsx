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
				"inline-flex min-w-0 items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
