import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_HINT_DELAY_MS = 500;

interface ShadowClickHintProps {
	hint: string;
	side?: "top" | "right" | "bottom" | "left";
	delayMs?: number;
	findRow: (e: React.MouseEvent) => HTMLElement | null;
	children: React.ReactNode;
}

export function ShadowClickHint({
	hint,
	side = "right",
	delayMs = DEFAULT_HINT_DELAY_MS,
	findRow,
	children,
}: ShadowClickHintProps) {
	const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
	const hoverRowRef = useRef<HTMLElement | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearTimer = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const handleMouseOver = useCallback(
		(e: React.MouseEvent<HTMLElement>) => {
			const row = findRow(e);
			if (!row) {
				if (hoverRowRef.current) {
					hoverRowRef.current = null;
					clearTimer();
					setHoverRect(null);
				}
				return;
			}
			if (hoverRowRef.current === row) return;
			hoverRowRef.current = row;
			clearTimer();
			setHoverRect(null);
			timerRef.current = setTimeout(() => {
				if (hoverRowRef.current === row) {
					setHoverRect(row.getBoundingClientRect());
				}
			}, delayMs);
		},
		[findRow, delayMs, clearTimer],
	);

	const handleMouseLeave = useCallback(() => {
		hoverRowRef.current = null;
		clearTimer();
		setHoverRect(null);
	}, [clearTimer]);

	useEffect(() => clearTimer, [clearTimer]);

	return (
		<fieldset
			className="contents"
			onFocus={(event) => {
				const row = event.nativeEvent
					.composedPath()
					.find((node) => node instanceof HTMLElement && node.dataset.itemPath);
				if (row instanceof HTMLElement)
					setHoverRect(row.getBoundingClientRect());
			}}
			onBlur={handleMouseLeave}
			onMouseOver={handleMouseOver}
			onMouseLeave={handleMouseLeave}
		>
			{hoverRect && hint && (
				<Tooltip open>
					<TooltipTrigger asChild>
						<span
							aria-hidden
							style={{
								position: "fixed",
								left: hoverRect.left,
								top: hoverRect.top,
								width: hoverRect.width,
								height: hoverRect.height,
								pointerEvents: "none",
							}}
						/>
					</TooltipTrigger>
					<TooltipContent side={side}>{hint}</TooltipContent>
				</Tooltip>
			)}
			{children}
		</fieldset>
	);
}
