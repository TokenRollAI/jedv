import { useEffect, useState } from "react";
import type { PullRequestTarget } from "../../types";
export function usePullRequestSelection(
	hostUrl: string,
	initialTarget?: PullRequestTarget,
) {
	const [selection, setSelection] = useState<{
		hostUrl: string;
		target: PullRequestTarget;
	} | null>(() => (initialTarget ? { hostUrl, target: initialTarget } : null));
	useEffect(() => {
		if (initialTarget) setSelection({ hostUrl, target: initialTarget });
	}, [hostUrl, initialTarget]);
	return {
		selected: selection?.hostUrl === hostUrl ? selection.target : null,
		setSelected: (target: PullRequestTarget | null) =>
			setSelection(target ? { hostUrl, target } : null),
	};
}
