import { Trans } from "@lingui/react/macro";
import { useEffect, useLayoutEffect, useRef } from "react";

export function filesSurfaceMatches(
	target: { hostUrl: string; workspaceId: string } | null,
	hostUrl: string,
	workspaceId: string,
) {
	return target?.hostUrl === hostUrl && target.workspaceId === workspaceId;
}
export function FilesPaneSlot({
	host,
	active,
	onActivate,
}: {
	host?: HTMLElement | null;
	active: boolean;
	onActivate(): void;
}) {
	const slot = useRef<HTMLDivElement>(null);
	const requested = useRef(false);
	useEffect(() => {
		if (active && !host && !requested.current) {
			requested.current = true;
			onActivate();
		}
	}, [active, host, onActivate]);
	useLayoutEffect(() => {
		const target = slot.current;
		if (!host || !target) return;
		target.appendChild(host);
		return () => {
			if (host.parentElement === target)
				document.getElementById("jedv-files-parking")?.appendChild(host);
		};
	}, [host]);
	return (
		<div ref={slot} className="flex h-full min-h-0 min-w-0 w-full flex-1">
			{!host && (
				<button
					type="button"
					className="m-auto rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
					onClick={onActivate}
				>
					<Trans>Open files</Trans>
				</button>
			)}
		</div>
	);
}
