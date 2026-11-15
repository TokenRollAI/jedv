import {
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@jedv/ui/dropdown-menu";
import type { TerminalLinkMenuItem } from "../../link-menu";

export function TerminalLinkMenuItems({
	items,
}: {
	items: TerminalLinkMenuItem[];
}) {
	return items.map((item) =>
		item.children ? (
			<DropdownMenuSub key={item.key}>
				<DropdownMenuSubTrigger disabled={item.disabled}>
					{item.icon}
					{item.label}
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="max-h-80 overflow-y-auto">
					<TerminalLinkMenuItems items={item.children} />
				</DropdownMenuSubContent>
			</DropdownMenuSub>
		) : (
			<DropdownMenuItem
				key={item.key}
				disabled={item.disabled}
				onSelect={item.onSelect}
			>
				{item.icon}
				{item.label}
				{item.shortcut && (
					<DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
				)}
			</DropdownMenuItem>
		),
	);
}
