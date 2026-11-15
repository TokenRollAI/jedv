import type { ReactNode } from "react";
import { ZoomStable } from "renderer/components/ZoomStable";
import { useWindowChrome } from "../../context";
import {
	WINDOW_CONTROLS_ROW_HEIGHT,
	WINDOW_CONTROLS_ROW_TOP,
} from "../../geometry";

export function WindowChromeControls({
	children,
	className = "",
	embedded = false,
}: {
	children: ReactNode;
	className?: string;
	embedded?: boolean;
}) {
	const { scale, counterScale } = useWindowChrome();
	const factor = embedded ? 1 : scale;
	return (
		<div
			className={`no-drag flex min-w-0 items-center self-start ${className}`}
			style={{
				marginTop: WINDOW_CONTROLS_ROW_TOP / factor,
				height: WINDOW_CONTROLS_ROW_HEIGHT / factor,
			}}
		>
			<ZoomStable
				enabled={!embedded && counterScale}
				className="no-drag flex max-w-full min-w-0 items-center"
			>
				{children}
			</ZoomStable>
		</div>
	);
}
