import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useState } from "react";
import {
	LuArchive,
	LuCircle,
	LuPause,
	LuRefreshCw,
	LuSquare,
	LuUsers,
} from "react-icons/lu";
import type { useTeamwork } from "../../hooks/useTeamwork";
import { JedvIconButton } from "../JedvIconButton";
import { SidebarSectionHeading } from "../SidebarSectionHeading";
import { TeamDirectoryActions } from "./components/TeamDirectoryActions";
export function TeamworkDirectory({
	index,
	selectedId,
	active,
	onSelect,
}: {
	index: ReturnType<typeof useTeamwork>;
	selectedId: string | null;
	active: boolean;
	onSelect(id: string): void;
}) {
	const { t } = useLingui();
	const [collapsed, setCollapsed] = useState(false),
		[archived, setArchived] = useState(false);
	const listId = useId();
	const selectedArchived =
		active &&
		index.list.data?.some(
			(team) => team.id === selectedId && team.status === "archived",
		);
	useEffect(() => {
		if (active && selectedId) setCollapsed(false);
	}, [active, selectedId]);
	useEffect(() => {
		if (selectedArchived) setArchived(true);
	}, [selectedArchived]);
	const teams =
		index.list.data?.filter((team) => archived || team.status !== "archived") ??
		[];
	const failed = index.capabilities.isError || index.list.isError;
	return (
		<section className="shrink-0 py-2" aria-label={t({ message: "Teamwork" })}>
			<SidebarSectionHeading
				label={<Trans>Teamwork</Trans>}
				collapsed={collapsed}
				controls={listId}
				onToggle={() => setCollapsed(!collapsed)}
			>
				<JedvIconButton
					label={t({ message: "Include archived teams" })}
					aria-pressed={archived}
					className={`size-6 ${archived ? "bg-fill-selected text-foreground" : ""}`}
					onClick={() => setArchived(!archived)}
				>
					<LuArchive className="size-3.5" />
				</JedvIconButton>
			</SidebarSectionHeading>
			<div id={listId} className="px-2" hidden={collapsed}>
				{(index.capabilities.isPending ||
					(index.supported && index.list.isPending)) && (
					<output className="block px-3 py-2 text-[11px] text-muted-foreground">
						<Trans>Loading teams…</Trans>
					</output>
				)}
				{failed && (
					<div
						role="alert"
						className="flex items-center gap-1 px-3 py-1 text-[11px] text-destructive"
					>
						<span className="flex-1">
							<Trans>
								Could not load Teamwork. Check the host connection and retry.
							</Trans>
						</span>
						<JedvIconButton
							label={t({ message: "Retry" })}
							onClick={() => {
								void index.capabilities.refetch();
								void index.list.refetch();
							}}
						>
							<LuRefreshCw className="size-3.5" />
						</JedvIconButton>
					</div>
				)}
				{teams.map((team) => {
					const status =
						team.status === "active"
							? t({ message: "Active" })
							: team.status === "paused"
								? t({ message: "Paused" })
								: team.status === "archived"
									? t({ message: "Archived" })
									: t({ message: "Stopped" });
					const Icon =
						team.status === "active"
							? LuCircle
							: team.status === "paused"
								? LuPause
								: team.status === "archived"
									? LuArchive
									: LuSquare;
					return (
						<div key={team.id} className="flex items-center gap-0.5">
							<button
								type="button"
								aria-current={
									active && selectedId === team.id ? "page" : undefined
								}
								title={`${team.name} · ${status}`}
								onClick={() => onSelect(team.id)}
								className={`flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active && selectedId === team.id ? "bg-fill-selected text-foreground" : "text-muted-foreground hover:bg-fill-hover hover:text-foreground"}`}
							>
								<LuUsers className="size-3.5 shrink-0" />
								<span className="min-w-0 flex-1 truncate">{team.name}</span>
								<Icon
									className={`size-3 shrink-0 ${team.status === "active" ? "text-success" : team.status === "paused" ? "text-warning" : "text-muted-foreground"}`}
									aria-hidden="true"
								/>
								<span className="sr-only">{status}</span>
							</button>
							<TeamDirectoryActions
								team={team}
								disabled={!index.supported || failed || !index.list.isSuccess}
								onDelete={index.deleteTeam}
								deleteSupported={
									index.capabilities.data?.features?.delete === true
								}
							/>
						</div>
					);
				})}
				{index.list.isSuccess && teams.length === 0 && (
					<p className="px-3 py-2 text-[11px] text-muted-foreground">
						<Trans>No teams yet</Trans>
					</p>
				)}
			</div>
		</section>
	);
}
