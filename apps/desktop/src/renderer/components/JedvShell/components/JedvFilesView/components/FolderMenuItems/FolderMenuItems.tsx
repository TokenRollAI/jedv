import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@jedv/ui/dropdown-menu";
import { Trans } from "@lingui/react/macro";
import { FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { PathActions } from "../PathActions";

interface FolderMenuItemsProps {
	absolutePath: string;
	relativePath: string;
	onNewFile: () => void;
	onNewFolder: () => void;
	onRename: () => void;
	onDelete: () => void;
	remote?: boolean;
	busy?: boolean;
}

export function FolderMenuItems({
	absolutePath,
	relativePath,
	onNewFile,
	onNewFolder,
	onRename,
	onDelete,
	remote = false,
	busy = false,
}: FolderMenuItemsProps) {
	return (
		<>
			<DropdownMenuItem
				disabled={busy}
				onSelect={() => setTimeout(onNewFile, 0)}
			>
				<FilePlus />
				<Trans>New File...</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={busy}
				onSelect={() => setTimeout(onNewFolder, 0)}
			>
				<FolderPlus />
				<Trans>New Folder...</Trans>
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
