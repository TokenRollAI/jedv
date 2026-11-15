import type { ReactNode } from "react";
export function NoticeRow({
	title,
	detail,
	actions,
}: {
	title: string;
	detail: string;
	actions: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4 rounded-lg bg-foreground/[0.05] p-4">
			<div className="min-w-0">
				<p className="font-medium text-foreground text-sm">{title}</p>
				<p className="mt-1 select-text break-words text-muted-foreground text-xs">
					{detail}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">{actions}</div>
		</div>
	);
}
