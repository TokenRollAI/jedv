import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import type { ContextMenuOpenContext } from "@pierre/trees";

interface PierreRowContextMenuProps extends Record<string, unknown> {
	anchorRect: ContextMenuOpenContext["anchorRect"];
	onClose: () => void;
	children: React.ReactNode;
}

export function PierreRowContextMenu({
	anchorRect,
	onClose,
	children,
	...attrs
}: PierreRowContextMenuProps) {
	return (
		<DropdownMenu open onOpenChange={(open) => !open && onClose()}>
			<DropdownMenuTrigger asChild>
				<span
					aria-hidden
					style={{
						position: "fixed",
						left: anchorRect.left,
						top: anchorRect.top,
						width: anchorRect.width,
						height: anchorRect.height,
						pointerEvents: "none",
					}}
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent {...attrs} className="w-64" align="start">
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
