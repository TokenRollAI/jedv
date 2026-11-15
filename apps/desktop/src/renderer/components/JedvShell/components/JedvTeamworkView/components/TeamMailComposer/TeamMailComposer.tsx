import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState, useSyncExternalStore } from "react";
import { LuArrowUp } from "react-icons/lu";
import type { TeamMember } from "../../../../hooks/useTeamwork";
import { JedvSelect } from "../../../JedvSelect";
import {
	type TeamMailDraftScope,
	TeamMailDraftStore,
	teamMailDrafts,
} from "../../team-mail-drafts";
import { TeamIconButton } from "../TeamIconButton";

const standaloneScope = { hostId: "standalone", teamId: "standalone" };
export function TeamMailComposer({
	members,
	disabled,
	pending,
	onSend,
	scope,
}: {
	members: TeamMember[];
	disabled: boolean;
	pending: boolean;
	onSend(to: string, body: string, dedupeKey: string): Promise<void>;
	scope?: TeamMailDraftScope;
}) {
	const { t } = useLingui();
	const [standalone] = useState(() => new TeamMailDraftStore());
	const [capacityError, setCapacityError] = useState(false);
	const store = scope ? teamMailDrafts : standalone;
	const targetScope = scope ?? standaloneScope;
	const draft = useSyncExternalStore(store.subscribe, () =>
		store.read(targetScope),
	);
	useEffect(() => store.sweep(), [store]);
	const { to, body } = draft;
	const locked = pending || draft.pending;
	const recipients = members.filter((member) => member.status === "active");
	const target = to;
	const validTarget =
		target === "team" || recipients.some((member) => member.name === target);
	const send = async () => {
		if (
			disabled ||
			locked ||
			!body.trim() ||
			recipients.length === 0 ||
			!validTarget
		)
			return;
		const request = store.begin(targetScope);
		if (!request) return;
		try {
			await onSend(request.to, request.body, request.key);
			store.settle(targetScope, request, true);
		} catch {
			/* The parent keeps the error visible and the draft is retained for retry. */
			store.settle(targetScope, request, false);
		}
	};
	return (
		<form
			className="mt-3 flex min-h-12 shrink-0 items-end gap-2 rounded-lg border border-border bg-background p-2"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<JedvSelect
				label={t({ message: "Mail recipient" })}
				value={target}
				onValueChange={(to) => {
					if (to) setCapacityError(!store.edit(targetScope, { to }));
				}}
				disabled={disabled || locked}
				options={[
					{ value: "team", label: t({ message: "Whole team" }) },
					...recipients.map((member) => ({
						value: member.name,
						label: member.name,
					})),
				]}
				className="max-w-40 shrink-0 self-end"
			/>
			<textarea
				value={body}
				maxLength={200_000}
				disabled={disabled || locked}
				onChange={(event) =>
					setCapacityError(
						!store.edit(targetScope, { body: event.target.value }),
					)
				}
				aria-label={t({ message: "Message to team" })}
				placeholder={t({ message: "Send instructions or ask the team…" })}
				rows={1}
				className="field-sizing-content min-h-7 max-h-40 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
				onKeyDown={(event) => {
					if (
						event.key === "Enter" &&
						(event.metaKey || event.ctrlKey) &&
						!event.nativeEvent.isComposing
					) {
						event.preventDefault();
						void send();
					}
				}}
			/>
			<TeamIconButton
				label={t({ message: "Send mail" })}
				disabled={
					disabled ||
					locked ||
					!body.trim() ||
					recipients.length === 0 ||
					!validTarget
				}
				onClick={() => void send()}
				className="bg-fill-selected"
			>
				<LuArrowUp className="size-4" />
			</TeamIconButton>
			{capacityError && (
				<p role="alert" className="text-xs text-destructive">
					<Trans>Unavailable</Trans>
				</p>
			)}
		</form>
	);
}
