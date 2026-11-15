import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuArrowDownWideNarrow } from "react-icons/lu";
import type { WorkspaceSortMode } from "../../project-tree";

export function ProjectSortMenu({
	value,
	disabled,
	onChange,
}: {
	value: WorkspaceSortMode;
	disabled: boolean;
	onChange(value: WorkspaceSortMode): void;
}) {
	const { t } = useLingui();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label={t({ message: "Workspace order" })}
					className="grid size-6 place-items-center rounded hover:bg-fill-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
				>
					<LuArrowDownWideNarrow className="size-3.5" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={(next) => onChange(next as WorkspaceSortMode)}
				>
					<DropdownMenuRadioItem value="manual">
						<Trans>Manual</Trans>
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="active">
						<Trans>Last activity</Trans>
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="created">
						<Trans>Created</Trans>
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
