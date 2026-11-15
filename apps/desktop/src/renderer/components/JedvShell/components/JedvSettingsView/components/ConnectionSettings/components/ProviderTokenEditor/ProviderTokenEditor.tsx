import { providerTokenSchema } from "@jedv/shared/teamwork-peers";
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
import type { z } from "zod";
import type { Team } from "../../../../../../hooks/useTeamwork";
import { JedvSelect } from "../../../../../JedvSelect";
export function ProviderTokenEditor({
	teams,
	onSave,
	onClose,
}: {
	teams: Team[];
	onSave(input: z.input<typeof providerTokenSchema>): Promise<void>;
	onClose(): void;
}) {
	const { t } = useLingui();
	const id = useId();
	const busy = useRef(false);
	const [name, setName] = useState(""),
		[teamId, setTeamId] = useState(teams[0]?.id ?? ""),
		[allowedTo, setAllowedTo] = useState("leader"),
		[typePrefix, setTypePrefix] = useState(""),
		[pending, setPending] = useState(false),
		[error, setError] = useState(false);
	const input = providerTokenSchema.safeParse({
		name,
		teamId,
		allowedTo,
		typePrefix,
	});
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy.current) onClose();
			}}
		>
			<DialogContent
				className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
				showCloseButton={!pending}
			>
				<DialogHeader>
					<DialogTitle>
						<Trans>Create provider token</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Mail-only access. The host administration key is never shared.
						</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={async (e) => {
						e.preventDefault();
						if (busy.current || !input.success) return;
						busy.current = true;
						setPending(true);
						setError(false);
						try {
							await onSave(input.data);
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
						<Label htmlFor={`${id}-name`} className="text-xs">
							<Trans>Name</Trans>
						</Label>
						<Input
							id={`${id}-name`}
							value={name}
							maxLength={120}
							disabled={pending}
							onChange={(e) => setName(e.target.value)}
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
							options={teams.map((team) => ({
								value: team.id,
								label: team.name,
							}))}
							disabled={pending}
							onValueChange={setTeamId}
							className="w-full"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-to`} className="text-xs">
							<Trans>Mail recipient</Trans>
						</Label>
						<Input
							id={`${id}-to`}
							value={allowedTo}
							maxLength={128}
							disabled={pending}
							onChange={(e) => setAllowedTo(e.target.value)}
							className="h-8 text-xs"
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor={`${id}-type`} className="text-xs">
							<Trans>Event type prefix</Trans>
						</Label>
						<Input
							id={`${id}-type`}
							value={typePrefix}
							maxLength={128}
							disabled={pending}
							onChange={(e) => setTypePrefix(e.target.value)}
							className="h-8 font-mono text-xs"
						/>
						<p className="text-[11px] text-muted-foreground">
							<Trans>Use provider.&lt;id&gt;. as the event type prefix.</Trans>
						</p>
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
						<Button
							type="submit"
							size="sm"
							disabled={pending || !input.success}
						>
							<Trans>Create</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
