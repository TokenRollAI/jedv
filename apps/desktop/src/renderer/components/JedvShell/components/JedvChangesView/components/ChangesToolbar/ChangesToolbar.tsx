import { Button } from "@jedv/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { cn } from "@jedv/ui/utils";
import { useLingui } from "@lingui/react/macro";
import { FoldVertical, Search, UnfoldVertical } from "lucide-react";
import type {
	Branch,
	ChangesFilter,
	ChangesViewMode,
	Commit,
} from "../../types";
import { ChangesScopeControl } from "../ChangesScopeControl";
import { ViewModeToggle } from "./components/ViewModeToggle";

interface ChangesToolbarProps {
	filter: ChangesFilter;
	onFilterChange: (filter: ChangesFilter) => void;
	commits: Commit[];
	uncommittedCount: number;
	viewMode: ChangesViewMode;
	onViewModeChange: (next: ChangesViewMode) => void;
	collapsed: boolean;
	onToggleFold: () => void;
	searchOpen: boolean;
	onToggleSearch: () => void;
	baseBranch: string;
	branches: Branch[];
	onBaseBranchChange: (branchName: string) => void;
	currentBranchName: string;
	canRenameBranch: boolean;
	onRenameBranch: (newName: string) => void;
}

export function ChangesToolbar({
	filter,
	onFilterChange,
	commits,
	uncommittedCount,
	viewMode,
	onViewModeChange,
	collapsed,
	onToggleFold,
	searchOpen,
	onToggleSearch,
	baseBranch,
	branches,
	onBaseBranchChange,
	currentBranchName,
	canRenameBranch,
	onRenameBranch,
}: ChangesToolbarProps) {
	const { t } = useLingui();
	const label = collapsed
		? t({ message: "Expand all" })
		: t({
				message: "Collapse all",
			});
	const Icon = collapsed ? UnfoldVertical : FoldVertical;
	const searchLabel = t({
		message: "Search changed files",
	});
	return (
		<div className="flex min-w-0 items-center gap-1 overflow-hidden py-1 pr-1 pl-1.5 text-xs">
			<ChangesScopeControl
				filter={filter}
				onFilterChange={onFilterChange}
				commits={commits}
				uncommittedCount={uncommittedCount}
				baseBranch={baseBranch}
				branches={branches}
				onBaseBranchChange={onBaseBranchChange}
				currentBranchName={currentBranchName}
				canRenameBranch={canRenameBranch}
				onRenameBranch={onRenameBranch}
			/>
			<div className="ml-auto flex shrink-0 items-center gap-0.5">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className={cn(
								"size-7 text-muted-foreground hover:text-foreground",
								searchOpen && "bg-accent text-foreground",
							)}
							onClick={onToggleSearch}
							aria-label={searchLabel}
							aria-pressed={searchOpen}
						>
							<Search className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">{searchLabel}</TooltipContent>
				</Tooltip>
				<ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="size-7 text-muted-foreground hover:text-foreground"
							onClick={onToggleFold}
							aria-label={label}
						>
							<Icon className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">{label}</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
