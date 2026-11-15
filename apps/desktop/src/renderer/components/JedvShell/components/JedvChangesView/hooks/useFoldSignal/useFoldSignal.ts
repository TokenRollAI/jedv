import { useCallback, useState } from "react";

export interface FoldSignal {
	epoch: number;
	action: "collapse" | "expand";
}

export function isFoldCollapsed(signal: FoldSignal): boolean {
	return signal.epoch > 0 && signal.action === "collapse";
}

export function useFoldSignal(startCollapsed = false) {
	const [foldSignal, setFoldSignal] = useState<FoldSignal>(() =>
		startCollapsed
			? { epoch: 1, action: "collapse" }
			: { epoch: 0, action: "expand" },
	);
	const toggleFold = useCallback(
		() =>
			setFoldSignal((s) => ({
				epoch: s.epoch + 1,
				action: isFoldCollapsed(s) ? "expand" : "collapse",
			})),
		[],
	);
	return { foldSignal, collapsed: isFoldCollapsed(foldSignal), toggleFold };
}
