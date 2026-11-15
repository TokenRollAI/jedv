import type { ReactNode } from "react";
import { useWindowChrome } from "./context";

export function WindowChrome({
	children,
	height = 48,
	className = "",
	embedded = false,
	primary = false,
}: {
	children: ReactNode;
	height?: 44 | 48;
	className?: string;
	embedded?: boolean;
	primary?: boolean;
}) {
	const { scale, notification } = useWindowChrome();
	return (
		<>
			<div
				data-window-chrome={embedded ? undefined : height}
				className={`jedv-window-chrome no-drag flex min-w-0 shrink-0 items-stretch ${className}`}
				style={{ height: height / (embedded ? 1 : scale) }}
			>
				{children}
			</div>
			{primary && notification}
		</>
	);
}
