import { Button } from "@jedv/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { useLingui } from "@lingui/react/macro";
import type { ContextMenuAnchorRect } from "@pierre/trees";
import { ChevronDown, Loader2, Minus, Plus, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PierreRowContextMenu } from "../../../JedvFilesView/components/PierreRowContextMenu";
import {
	resolveChangesSidebarFileIntent,
	sidebarFilePolicy,
} from "../../../JedvFilesView/utils/clickPolicy";
import type { Category, ChangedFile } from "../../types";
import { ChangedFileRow } from "../ChangedFileRow";
import { ChangesFileMenu } from "../ChangesFileMenu";
export function ChangesRow({
	file,
	category,
	selected,
	busy,
	onSelect,
	onOpen,
	onStage,
	onDiscard,
	onCopy,
	onExternal,
	remote,
	rootPath,
	active = true,
}: {
	file: ChangedFile;
	category: Category;
	selected: boolean;
	busy: boolean;
	onSelect(newTab?: boolean): void;
	onOpen(pinned?: boolean): void;
	onStage(): void;
	onDiscard(): void;
	onCopy(path: string): void;
	onExternal(path: string): void;
	remote: boolean;
	rootPath?: string;
	active?: boolean;
}) {
	const { t } = useLingui();
	const [anchor, setAnchor] = useState<ContextMenuAnchorRect | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	useEffect(() => {
		if (!active) {
			setMenuOpen(false);
			setAnchor(null);
		}
	}, [active]);
	const menu = (
		<ChangesFileMenu
			remote={remote}
			rootPath={rootPath}
			onExternal={() => onExternal(file.path)}
			file={file}
			category={category}
			busy={busy}
			onDiff={onSelect}
			onOpen={onOpen}
			onStage={onStage}
			onDiscard={onDiscard}
			onCopy={() => onCopy(file.path)}
		/>
	);
	const canStage = category === "staged" || category === "unstaged";
	return (
		<div className="group relative flex items-center">
			<ChangedFileRow
				onContextMenu={(event) => {
					event.preventDefault();
					const x = event.clientX,
						y = event.clientY;
					setAnchor({
						x,
						y,
						left: x,
						right: x,
						top: y,
						bottom: y,
						width: 0,
						height: 0,
					});
				}}
				{...file}
				isSelected={selected}
				hideDir
				hideStatsOnHover
				onClick={(event) => {
					const intent = resolveChangesSidebarFileIntent(
						sidebarFilePolicy.map,
						event,
					);
					if (intent === "external") onExternal(file.path);
					else if (intent === "file") onOpen(false);
					else if (intent) onSelect(intent === "diffNewTab");
				}}
				onDoubleClick={
					file.status === "deleted" ? undefined : () => onOpen(true)
				}
			/>
			<div
				className={`absolute right-1 flex items-center ${selected ? "bg-accent" : "bg-popover/95"} opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`}
			>
				{category === "unstaged" && (
					<Button
						variant="ghost"
						size="icon"
						className="size-6"
						disabled={
							busy || file.status === "renamed" || file.status === "copied"
						}
						aria-label={t({ message: "Discard Changes" })}
						title={t({ message: "Discard Changes" })}
						onClick={onDiscard}
					>
						<Undo2 className="size-3.5" />
					</Button>
				)}
				{canStage && (
					<Button
						variant="ghost"
						size="icon"
						className="size-6"
						disabled={busy}
						aria-label={
							category === "staged"
								? t({ message: "Unstage file" })
								: t({ message: "Stage file" })
						}
						title={
							category === "staged"
								? t({ message: "Unstage file" })
								: t({ message: "Stage file" })
						}
						onClick={onStage}
					>
						{busy ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : category === "staged" ? (
							<Minus className="size-3.5" />
						) : (
							<Plus className="size-3.5" />
						)}
					</Button>
				)}
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="size-6"
							aria-label={t({ message: "More actions" })}
						>
							<ChevronDown className="size-3.5" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">{menu}</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{anchor && (
				<PierreRowContextMenu
					anchorRect={anchor}
					onClose={() => setAnchor(null)}
				>
					{menu}
				</PierreRowContextMenu>
			)}
		</div>
	);
}
