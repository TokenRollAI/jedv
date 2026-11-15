import { DropdownMenuItem, DropdownMenuShortcut } from "@jedv/ui/dropdown-menu";
import { Trans } from "@lingui/react/macro";
import {
	VscFolderOpened,
	VscGithubAlt,
	VscLayout,
	VscNewFolder,
} from "react-icons/vsc";
import type { ProjectActionKind } from "../types";

export function JedvProjectMenuItems({
	onAction,
	disabled = false,
	openShortcut,
}: {
	onAction(kind: ProjectActionKind): void;
	disabled?: boolean;
	openShortcut?: string;
}) {
	return (
		<>
			<DropdownMenuItem disabled={disabled} onSelect={() => onAction("open")}>
				<VscFolderOpened className="size-4 shrink-0" />
				<span className="flex-1">
					<Trans>Open project</Trans>
				</span>
				{openShortcut && (
					<DropdownMenuShortcut>{openShortcut}</DropdownMenuShortcut>
				)}
			</DropdownMenuItem>
			<DropdownMenuItem disabled={disabled} onSelect={() => onAction("clone")}>
				<VscGithubAlt className="size-4 shrink-0" />
				<Trans>Clone from URL</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem disabled={disabled} onSelect={() => onAction("empty")}>
				<VscNewFolder className="size-4 shrink-0" />
				<Trans>Create new project</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={disabled}
				onSelect={() => onAction("template")}
			>
				<VscLayout className="size-4 shrink-0" />
				<Trans>Start from a template</Trans>
			</DropdownMenuItem>
		</>
	);
}
