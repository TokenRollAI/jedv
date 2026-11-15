import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";

interface FolderHeaderProps {
	label: string;
	fileCount: number;
	isOpen: boolean;
	onToggle: () => void;
}

export function FolderHeader({
	label,
	fileCount,
	isOpen,
	onToggle,
}: FolderHeaderProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={isOpen}
					className="flex w-full items-center gap-1.5 py-1 pr-3 pl-3 text-left text-xs text-muted-foreground hover:bg-accent/30"
				>
					{}
					<span className="min-w-0 flex-1 truncate" dir="rtl">
						<span dir="ltr">{label}</span>
					</span>
					<span className="ml-auto shrink-0 text-[11px] tabular-nums">
						{fileCount}
					</span>
				</button>
			</TooltipTrigger>
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	);
}
