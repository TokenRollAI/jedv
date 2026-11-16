import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { LuEllipsis, LuTrash2 } from "react-icons/lu";
import type { Team } from "../../../../hooks/useTeamwork";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../JedvConfirmDialog/JedvConfirmDialog";
import { JedvIconButton } from "../../../JedvIconButton";

export function TeamDirectoryActions({
	team,
	disabled,
	deleteSupported,
	onDelete,
}: {
	team: Team;
	disabled: boolean;
	deleteSupported: boolean;
	onDelete(teamId: string): Promise<void>;
}) {
	const { t } = useLingui();
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const current = useRef({ disabled, onDelete });
	current.current = { disabled: disabled || !deleteSupported, onDelete };

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<JedvIconButton
						label={t({ message: `Actions for ${team.name}` })}
						disabled={disabled}
						className="size-6 shrink-0 text-muted-foreground"
					>
						<LuEllipsis className="size-3.5" />
					</JedvIconButton>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						disabled={!deleteSupported}
						className="text-destructive"
						title={
							!deleteSupported
								? t({ message: "Update the host to delete teams." })
								: undefined
						}
						onSelect={() =>
							setConfirmation({
								title: t({ message: "Delete this team?" }),
								description: t({
									message:
										"Permanently delete this team, its members, mail, shared team memory and alerts. Team-created agents will be stopped. Existing terminals added to the team, workspaces and files are kept. This cannot be undone.",
								}),
								detail: team.name,
								execute: async () => {
									if (current.current.disabled)
										throw new Error(
											t({
												message:
													"Host offline. Team actions are unavailable until the connection is restored.",
											}),
										);
									await current.current.onDelete(team.id);
								},
							})
						}
					>
						<LuTrash2 className="size-3.5" />
						<Trans>Delete team</Trans>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{confirmation && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</>
	);
}
