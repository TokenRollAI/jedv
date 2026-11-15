import { useLayoutEffect, useRef } from "react";
export function WorkspaceToolbarSlot({ host }: { host: HTMLElement }) {
	const slot = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const target = slot.current;
		if (!target) return;
		target.appendChild(host);
		return () => {
			if (host.parentElement === target)
				document.getElementById("jedv-toolbar-parking")?.appendChild(host);
		};
	}, [host]);
	return <div ref={slot} className="flex h-full shrink-0 items-center px-1" />;
}
