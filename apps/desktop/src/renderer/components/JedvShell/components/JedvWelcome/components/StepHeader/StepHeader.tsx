import type { ReactNode } from "react";
export function StepHeader({
	title,
	subtitle,
	icon,
}: {
	title: string;
	subtitle?: string;
	icon?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center gap-4 text-center">
			{icon}
			<div className="space-y-1">
				<h1 className="text-[14px] font-semibold text-foreground">{title}</h1>
				{subtitle && (
					<p className="text-[12px] text-muted-foreground">{subtitle}</p>
				)}
			</div>
		</div>
	);
}
