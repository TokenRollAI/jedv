import { Button } from "@jedv/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { useLingui } from "@lingui/react/macro";
import { Folder, ListTree } from "lucide-react";
import type { ChangesViewMode } from "../../../../types";

interface ViewModeToggleProps {
	viewMode: ChangesViewMode;
	onChange: (next: ChangesViewMode) => void;
}

export function ViewModeToggle({ viewMode, onChange }: ViewModeToggleProps) {
	const { t } = useLingui();
	const next: ChangesViewMode = viewMode === "folders" ? "tree" : "folders";
	const label =
		next === "tree"
			? t({ message: "Tree view" })
			: t({
					message: "Folder view",
				});
	const Icon = next === "tree" ? ListTree : Folder;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-7 text-muted-foreground hover:text-foreground"
					onClick={() => onChange(next)}
					aria-label={label}
				>
					<Icon className="size-3.5" />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}
