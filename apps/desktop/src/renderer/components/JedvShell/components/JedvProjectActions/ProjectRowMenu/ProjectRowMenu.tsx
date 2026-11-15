import * as C from "@jedv/ui/context-menu";
import * as D from "@jedv/ui/dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { type ReactNode, useRef } from "react";
import type { IconType } from "react-icons";
import { HiEllipsisHorizontal } from "react-icons/hi2";

export interface ProjectRowAction {
	label: string;
	icon: IconType;
	run(): void;
	disabled?: boolean;
	destructive?: boolean;
	separator?: boolean;
	shortcut?: string;
}
export function ProjectRowMenu({
	children,
	actions,
}: {
	children: ReactNode;
	actions: ProjectRowAction[];
}) {
	const { t } = useLingui();
	const row = useRef<HTMLDivElement>(null);
	const pending = useRef<(() => void) | null>(null);
	const close = (event: Event) => {
		event.preventDefault();
		const action = pending.current;
		pending.current = null;
		if (action) requestAnimationFrame(action);
		else row.current?.querySelector<HTMLButtonElement>("button")?.focus();
	};
	const items = (context: boolean) => {
		const Item = context ? C.ContextMenuItem : D.DropdownMenuItem;
		const Separator = context
			? C.ContextMenuSeparator
			: D.DropdownMenuSeparator;
		const Shortcut = context ? C.ContextMenuShortcut : D.DropdownMenuShortcut;
		return actions.map((action, index) => (
			<div key={action.label}>
				{action.separator && index > 0 && <Separator />}
				<Item
					disabled={action.disabled}
					variant={action.destructive ? "destructive" : "default"}
					onSelect={() => {
						pending.current = action.run;
					}}
				>
					<action.icon className="size-4 shrink-0" />
					<span className="flex-1">{action.label}</span>
					{action.shortcut && <Shortcut>{action.shortcut}</Shortcut>}
				</Item>
			</div>
		));
	};
	return (
		<C.ContextMenu>
			<C.ContextMenuTrigger asChild>
				<div
					ref={row}
					className="group relative mx-2 flex h-7 items-center rounded-md hover:bg-fill-hover"
				>
					{children}
					<D.DropdownMenu>
						<D.DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-label={t({ message: "Project options" })}
								className="absolute right-1 grid size-5 place-items-center rounded text-muted-foreground opacity-0 hover:bg-foreground/10 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
							>
								<HiEllipsisHorizontal className="size-4" />
							</button>
						</D.DropdownMenuTrigger>
						<D.DropdownMenuContent
							side="right"
							align="start"
							className="max-w-[calc(100vw-2rem)] min-w-52"
							onCloseAutoFocus={close}
						>
							{items(false)}
						</D.DropdownMenuContent>
					</D.DropdownMenu>
				</div>
			</C.ContextMenuTrigger>
			<C.ContextMenuContent
				className="max-w-[calc(100vw-2rem)] min-w-52"
				onCloseAutoFocus={close}
			>
				{items(true)}
			</C.ContextMenuContent>
		</C.ContextMenu>
	);
}
