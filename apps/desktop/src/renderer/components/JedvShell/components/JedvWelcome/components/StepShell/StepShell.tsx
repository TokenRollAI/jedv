import { cn } from "@jedv/ui/utils";
import type { ReactNode } from "react";
export function StepShell({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className="flex min-h-full w-full items-center justify-center bg-background px-6 py-8">
			<div
				className={cn("flex w-full max-w-[420px] flex-col gap-5", className)}
			>
				{children}
			</div>
		</div>
	);
}
