import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
} from "@jedv/ui/dropdown-menu";
import { Trans } from "@lingui/react/macro";
import {
	Copy,
	ExternalLink,
	FileText,
	GitCompare,
	Minus,
	Plus,
	SquarePlus,
	Undo2,
} from "lucide-react";
import { PathActions } from "../../../JedvFilesView/components/PathActions";
import { modifierLabel } from "../../../JedvFilesView/utils/clickPolicy";
import { resolveWorkspaceFilePath } from "../../../JedvFilesView/utils/workspace-path";
import type { Category, ChangedFile } from "../../types";
export function ChangesFileMenu({
	file,
	category,
	busy,
	onDiff,
	onOpen,
	onStage,
	onDiscard,
	onCopy,
	onExternal,
	remote,
	rootPath,
}: {
	file: ChangedFile;
	category: Category;
	busy: boolean;
	onDiff(newTab?: boolean): void;
	onOpen(pinned?: boolean): void;
	onStage(): void;
	onDiscard(): void;
	onCopy(): void;
	onExternal(): void;
	remote: boolean;
	rootPath?: string;
}) {
	const absolutePath = rootPath
		? resolveWorkspaceFilePath(rootPath, file.path)
		: null;
	return (
		<>
			<DropdownMenuItem onSelect={() => onDiff(false)}>
				<GitCompare />
				<Trans>Open Diff</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => onDiff(true)}>
				<SquarePlus />
				<Trans>Open Diff in New Tab</Trans>
				<DropdownMenuShortcut>{modifierLabel("shift")}</DropdownMenuShortcut>
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={file.status === "deleted"}
				onSelect={() => onOpen(false)}
			>
				<FileText />
				<Trans>Open File</Trans>
				<DropdownMenuShortcut>{modifierLabel("meta")}</DropdownMenuShortcut>
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={file.status === "deleted"}
				onSelect={() => onOpen(true)}
			>
				<SquarePlus />
				<Trans>Open File in New Tab</Trans>
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={remote || !absolutePath || file.status === "deleted"}
				onSelect={onExternal}
			>
				<ExternalLink />
				<Trans>Open in Editor</Trans>
				<DropdownMenuShortcut>
					{modifierLabel("metaShift")}
				</DropdownMenuShortcut>
			</DropdownMenuItem>
			{absolutePath ? (
				<PathActions
					absolutePath={absolutePath}
					relativePath={file.path}
					remote={remote}
				/>
			) : (
				<DropdownMenuItem onSelect={onCopy}>
					<Copy />
					<Trans>Copy Relative Path</Trans>
				</DropdownMenuItem>
			)}
			{(category === "staged" || category === "unstaged") && (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuItem disabled={busy} onSelect={onStage}>
						{category === "staged" ? <Minus /> : <Plus />}
						{category === "staged" ? (
							<Trans>Unstage file</Trans>
						) : (
							<Trans>Stage file</Trans>
						)}
					</DropdownMenuItem>
					{category === "unstaged" && (
						<DropdownMenuItem
							disabled={
								busy || file.status === "renamed" || file.status === "copied"
							}
							variant="destructive"
							onSelect={onDiscard}
						>
							<Undo2 />
							<Trans>Discard Changes</Trans>
						</DropdownMenuItem>
					)}
				</>
			)}
		</>
	);
}
