import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState, useSyncExternalStore } from "react";
import { LuArrowUp } from "react-icons/lu";
import type { TeamMember } from "../../../../hooks/useTeamwork";
import { JedvSelect } from "../../../JedvSelect";
import {
	type MailDeliveryOptions,
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
	deliveryModesSupported = false,
	interruptSupported = false,
}: {
	members: TeamMember[];
	disabled: boolean;
	pending: boolean;
	onSend(
		to: string,
		body: string,
		dedupeKey: string,
		options?: MailDeliveryOptions,
	): Promise<void>;
	deliveryModesSupported?: boolean;
	interruptSupported?: boolean;
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
	const canInterrupt = deliveryModesSupported && interruptSupported;
	const modeUnavailable = draft.deliveryMode === "interrupt" && !canInterrupt;
	const recipients = members.filter((member) => member.status === "active");
	const target = to;
	const validTarget =
		target === "team" || recipients.some((member) => member.name === target);
	const send = async () => {
		if (
			disabled ||
			modeUnavailable ||
			locked ||
			!body.trim() ||
			recipients.length === 0 ||
			!validTarget
		)
			return;
		const request = store.begin(targetScope, deliveryModesSupported);
		if (!request) return;
		try {
			await onSend(request.to, request.body, request.key, request.options);
			store.settle(targetScope, request, true);
		} catch {
			/* The parent keeps the error visible and the draft is retained for retry. */
			store.settle(targetScope, request, false);
		}
	};
	return (
		<form
			className="mt-3 flex min-h-12 shrink-0 flex-wrap items-end gap-2 rounded-lg border border-border bg-background p-2"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<div className="flex basis-full flex-wrap items-center gap-2 border-b border-border/60 pb-2">
				<select
					aria-label={t({ message: "Delivery mode" })}
					className="rounded border border-border bg-background p-1 text-xs focus-visible:ring-2 focus-visible:ring-ring"
					value={draft.deliveryMode}
					disabled={disabled || locked}
					onChange={(event) =>
						setCapacityError(
							!store.edit(targetScope, {
								deliveryMode:
									event.target.value === "interrupt" ? "interrupt" : "queue",
							}),
						)
					}
				>
					<option value="queue">{t({ message: "Queue message" })}</option>
					<option value="interrupt" disabled={!canInterrupt}>
						{t({ message: "Interrupt now" })}
					</option>
				</select>
				<p className="text-[11px] text-muted-foreground">
					{canInterrupt ? (
						<Trans>
							Queue waits for the agent. Interrupt requires safe support from
							the current session. Both require recipient acknowledgement;
							sending is not consumption.
						</Trans>
					) : (
						<Trans>
							Safe interruption is unavailable on this host. Queued mail waits
							for the agent; sending does not confirm consumption.
						</Trans>
					)}
				</p>
			</div>
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
					modeUnavailable ||
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
