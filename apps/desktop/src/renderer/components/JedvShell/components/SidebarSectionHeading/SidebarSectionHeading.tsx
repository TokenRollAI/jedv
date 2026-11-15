import type { ReactNode } from "react";
import { LuChevronRight } from "react-icons/lu";

export function SidebarSectionHeading({
	label,
	collapsed,
	controls,
	onToggle,
	children,
}: {
	label: ReactNode;
	collapsed: boolean;
	controls?: string;
	onToggle(): void;
	children?: ReactNode;
}) {
	return (
		<div className="flex h-7 shrink-0 items-center gap-1.5 pl-4 pr-2 text-[10px] font-semibold uppercase tracking-[0.075em] text-muted-foreground">
			<button
				type="button"
				aria-expanded={!collapsed}
				aria-controls={controls}
				onClick={onToggle}
				className="flex min-w-12 flex-1 items-center gap-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			>
				<LuChevronRight
					className={`size-3 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
				/>
				<span className="min-w-0 truncate">{label}</span>
			</button>
			{children && (
				<div className="flex min-w-0 shrink items-center gap-1.5 overflow-x-auto [&>*]:shrink-0">
					{children}
				</div>
			)}
		</div>
	);
}
