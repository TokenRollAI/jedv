import { Button } from "@jedv/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@jedv/ui/dialog";
import { Input } from "@jedv/ui/input";
import { Label } from "@jedv/ui/label";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useRef, useState } from "react";
import type { Team } from "../../../../../../hooks/useTeamwork";
import { JedvSelect } from "../../../../../JedvSelect";
export function SlotInstaller({
	teams,
	onSave,
	onClose,
}: {
	teams: Team[];
	onSave(input: { manifestPath: string; bindTeamId?: string }): Promise<void>;
	onClose(): void;
}) {
	const { t } = useLingui();
	const id = useId();
	const busy = useRef(false);
	const [path, setPath] = useState(""),
		[teamId, setTeamId] = useState(""),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
				<DialogHeader>
					<DialogTitle>
						<Trans>Install extension</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Extensions display data and can receive narrowly scoped mail.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={async (e) => {
						e.preventDefault();
						if (!path.trim() || busy.current) return;
						busy.current = true;
						setPending(true);
						setError(false);
						try {
							await onSave({
								manifestPath: path.trim(),
								...(teamId ? { bindTeamId: teamId } : {}),
							});
							onClose();
						} catch {
							setError(true);
						} finally {
							busy.current = false;
							setPending(false);
						}
					}}
				>
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-path`} className="text-xs">
							<Trans>Manifest path on host</Trans>
						</Label>
						<Input
							id={`${id}-path`}
							value={path}
							maxLength={4096}
							disabled={pending}
							onChange={(e) => setPath(e.target.value)}
							className="h-8 text-xs"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-team`} className="text-xs">
							<Trans>Team</Trans>
						</Label>
						<JedvSelect
							id={`${id}-team`}
							label={t({ message: "Team" })}
							value={teamId}
							options={[
								{ value: "", label: t({ message: "No team" }) },
								...teams.map((team) => ({ value: team.id, label: team.name })),
							]}
							disabled={pending}
							onValueChange={setTeamId}
							className="w-full"
						/>
					</div>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							<Trans>Operation failed</Trans>
						</p>
					)}
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={pending}
							onClick={onClose}
						>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" size="sm" disabled={pending || !path.trim()}>
							<Trans>Install</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
