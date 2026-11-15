import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
} from "@jedv/ui/dropdown-menu";
import { Trans } from "@lingui/react/macro";
import {
	ExternalLink,
	FileText,
	Pencil,
	SquarePlus,
	Trash2,
} from "lucide-react";
import { modifierLabel } from "../../utils/clickPolicy";
import { PathActions } from "../PathActions";

export function FileMenuItems({
	absolutePath,
	relativePath,
	onOpen,
	onOpenInNewTab,
	onOpenInEditor,
	onRename,
	onDelete,
	remote = false,
	busy = false,
}: {
	absolutePath: string;
	relativePath: string;
	onOpen(): void;
	onOpenInNewTab(): void;
	onOpenInEditor(): void;
	onRename(): void;
	onDelete(): void;
	remote?: boolean;
	busy?: boolean;
}) {
	return (
		<>
			<DropdownMenuItem onSelect={onOpen}>
				<FileText />
				<Trans>Open</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={onOpenInNewTab}>
				<SquarePlus />
				<Trans>Open in New Tab</Trans>
				<DropdownMenuShortcut>{modifierLabel("shift")}</DropdownMenuShortcut>
			</DropdownMenuItem>
			<DropdownMenuItem disabled={remote || busy} onSelect={onOpenInEditor}>
				<ExternalLink />
				<Trans>Open in Editor</Trans>
				<DropdownMenuShortcut>
					{modifierLabel("metaShift")}
				</DropdownMenuShortcut>
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<PathActions
				absolutePath={absolutePath}
				relativePath={relativePath}
				remote={remote}
			/>
			<DropdownMenuSeparator />
			<DropdownMenuItem
				disabled={busy}
				onSelect={() => setTimeout(onRename, 0)}
			>
				<Pencil />
				<Trans>Rename...</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem
				variant="destructive"
				disabled={busy}
				onSelect={onDelete}
			>
				<Trash2 />
				<Trans>Delete</Trans>
			</DropdownMenuItem>
		</>
	);
}
