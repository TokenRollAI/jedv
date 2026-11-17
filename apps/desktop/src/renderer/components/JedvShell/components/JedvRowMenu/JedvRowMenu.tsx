import * as C from "@jedv/ui/context-menu";
import * as D from "@jedv/ui/dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import { type ReactNode, useRef } from "react";
import { HiEllipsisHorizontal } from "react-icons/hi2";
export interface RowAction {
	label: string;
	run?: () => void;
	destructive?: boolean;
	children?: RowAction[];
	icon?: ReactNode;
	shortcut?: string;
	disabled?: boolean;
	disabledReason?: string;
	separator?: boolean;
}
export function JedvRowMenu({
	children,
	actions,
	className = "",
	onDismiss,
}: {
	children: ReactNode;
	actions: RowAction[];
	className?: string;
	onDismiss?: () => void;
}) {
	const { t } = useLingui();
	const row = useRef<HTMLDivElement>(null);
	const pending = useRef<(() => void) | null>(null);
	const close = (event: Event) => {
		event.preventDefault();
		const action = pending.current;
		pending.current = null;
		if (action) requestAnimationFrame(action);
		else if (onDismiss) onDismiss();
		else row.current?.querySelector<HTMLButtonElement>("button")?.focus();
	};
	const items = (context: boolean, entries: RowAction[]): ReactNode => {
		const Item = context ? C.ContextMenuItem : D.DropdownMenuItem;
		const Sub = context ? C.ContextMenuSub : D.DropdownMenuSub;
		const Trigger = context
			? C.ContextMenuSubTrigger
			: D.DropdownMenuSubTrigger;
		const Content = context
			? C.ContextMenuSubContent
			: D.DropdownMenuSubContent;
		const Separator = context
			? C.ContextMenuSeparator
			: D.DropdownMenuSeparator;
		const Shortcut = context ? C.ContextMenuShortcut : D.DropdownMenuShortcut;
		return entries.map((action, index) => (
			<div key={action.label}>
				{action.separator && index > 0 && <Separator />}
				{action.children ? (
					<Sub>
						<Trigger disabled={action.disabled} title={action.disabledReason}>
							{action.icon}
							<span className="flex-1">{action.label}</span>
						</Trigger>
						<Content className="max-w-[calc(100vw-2rem)]">
							{items(context, action.children)}
						</Content>
					</Sub>
				) : (
					<Item
						disabled={action.disabled}
						title={action.disabledReason}
						variant={action.destructive ? "destructive" : "default"}
						onSelect={() => {
							pending.current = action.run ?? null;
						}}
					>
						{action.icon}
						<span className="flex-1">{action.label}</span>
						{action.shortcut && <Shortcut>{action.shortcut}</Shortcut>}
					</Item>
				)}
			</div>
		));
	};
	return (
		<C.ContextMenu>
			<C.ContextMenuTrigger asChild>
				<div
					ref={row}
					className={`group relative flex items-center ${className}`}
				>
					{children}
					<D.DropdownMenu>
						<D.DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-label={t({ message: "More options" })}
								className="absolute right-1 grid size-5 place-items-center rounded text-muted-foreground opacity-0 hover:bg-foreground/10 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 data-[state=open]:opacity-100"
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
							{items(false, actions)}
						</D.DropdownMenuContent>
					</D.DropdownMenu>
				</div>
			</C.ContextMenuTrigger>
			<C.ContextMenuContent
				className="max-w-[calc(100vw-2rem)] min-w-52"
				onCloseAutoFocus={close}
			>
				{items(true, actions)}
			</C.ContextMenuContent>
		</C.ContextMenu>
	);
}
