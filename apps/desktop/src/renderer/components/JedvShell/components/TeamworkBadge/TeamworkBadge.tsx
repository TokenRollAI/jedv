import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { useLingui } from "@lingui/react/macro";
import { LuUsers } from "react-icons/lu";
import type { WorkspaceTeam } from "../../hooks/useTeamwork";
export function TeamworkBadge({
	teams,
	onSelect,
}: {
	teams: WorkspaceTeam[];
	onSelect(id: string): void;
}) {
	const { t } = useLingui();
	if (!teams.length) return null;
	const label = t({ message: "Open Teamwork" });
	const names = teams.map((team) => team.name).join(", ");
	const button = (
		<button
			type="button"
			aria-label={`${label}: ${names}`}
			className="ml-auto flex h-5 shrink-0 items-center gap-1 rounded bg-fill-selected px-1.5 text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={teams.length === 1 ? () => onSelect(teams[0].id) : undefined}
		>
			<LuUsers className="size-3" />
			<span>{teams.length === 1 ? teams[0].count : teams.length}</span>
		</button>
	);
	return teams.length === 1 ? (
		<Tooltip>
			<TooltipTrigger asChild>{button}</TooltipTrigger>
			<TooltipContent>{names}</TooltipContent>
		</Tooltip>
	) : (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				{teams.map((team) => (
					<DropdownMenuItem key={team.id} onSelect={() => onSelect(team.id)}>
						<LuUsers className="size-3.5" />
						{team.name}
						<span className="ml-auto text-muted-foreground">{team.count}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
