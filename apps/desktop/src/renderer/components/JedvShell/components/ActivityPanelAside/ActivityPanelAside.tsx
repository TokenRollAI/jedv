import { useLingui } from "@lingui/react/macro";
import { useLayoutEffect, useRef } from "react";

export function ActivityPanelAside({
	hidden,
	top,
	onTarget,
	onFits,
}: {
	hidden: boolean;
	top?: number;
	onTarget(node: HTMLElement | null): void;
	onFits(fits: boolean): void;
}) {
	const { t } = useLingui();
	const aside = useRef<HTMLElement>(null);
	useLayoutEffect(() => {
		const host = aside.current?.parentElement;
		if (!host) return;
		const measure = () => onFits(host.clientWidth >= 1496);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(host);
		return () => {
			observer.disconnect();
			onFits(false);
		};
	}, [onFits]);
	return (
		<aside
			ref={(node) => {
				aside.current = node;
				onTarget(node);
			}}
			style={{ top }}
			aria-label={t({ message: "Workspace activity" })}
			hidden={hidden}
			className="pointer-events-none absolute inset-y-0 right-3 z-10 flex w-80 min-h-0 flex-col py-2 [&>[data-activity-panel]]:pointer-events-auto"
		/>
	);
}
