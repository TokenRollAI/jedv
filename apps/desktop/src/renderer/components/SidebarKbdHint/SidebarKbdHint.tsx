interface SidebarKbdHintProps {
	label: string;
}

/**
 * Keycap-style shortcut hint for a sidebar nav item. Invisible until the
 * parent row (which carries the `group` class) is hovered or focused; toggled
 * via `visibility` so it always reserves its space and the row never shifts.
 */
export function SidebarKbdHint({ label }: SidebarKbdHintProps) {
	return (
		<kbd className="invisible inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded border border-border/70 bg-muted/40 px-1.5 font-mono text-[10.5px] font-medium text-muted-foreground group-hover:visible group-focus-visible:visible">
			{label}
		</kbd>
	);
}
