import { cn } from "@jedv/ui/utils";
import { Trans } from "@lingui/react/macro";
import type { Branch, ChangesFilter, Commit } from "../../types";
import { BaseBranchSelector } from "../BaseBranchSelector";
import { CommitFilterDropdown } from "../CommitFilterDropdown";

interface ChangesScopeControlProps {
	filter: ChangesFilter;
	onFilterChange: (filter: ChangesFilter) => void;
	commits: Commit[];
	uncommittedCount: number;
	baseBranch: string;
	branches: Branch[];
	onBaseBranchChange: (branchName: string) => void;
	currentBranchName: string;
	canRenameBranch: boolean;
	onRenameBranch: (newName: string) => void;
	baseClassName?: string;
	commitLabelClassName?: string;
}

export function ChangesScopeControl({
	filter,
	onFilterChange,
	commits,
	uncommittedCount,
	baseBranch,
	branches,
	onBaseBranchChange,
	currentBranchName,
	canRenameBranch,
	onRenameBranch,
	baseClassName,
	commitLabelClassName,
}: ChangesScopeControlProps) {
	return (
		<>
			<CommitFilterDropdown
				filter={filter}
				onFilterChange={onFilterChange}
				commits={commits}
				uncommittedCount={uncommittedCount}
				currentBranchName={currentBranchName}
				canRenameBranch={canRenameBranch}
				onRenameBranch={onRenameBranch}
				labelClassName={commitLabelClassName}
			/>
			{filter.kind === "all" && (
				<span
					className={cn(
						"flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap",
						baseClassName,
					)}
				>
					<Trans>
						<span className="shrink-0 text-muted-foreground/60">vs</span>{" "}
						<BaseBranchSelector
							branches={branches}
							currentValue={baseBranch}
							onChange={onBaseBranchChange}
						/>
					</Trans>
				</span>
			)}
		</>
	);
}
