import { Tooltip, TooltipContent, TooltipTrigger } from "@jedv/ui/tooltip";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState, useSyncExternalStore } from "react";
import { LuArrowUp, LuInfo } from "react-icons/lu";
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
	const recipients = members.filter((member) => member.status === "active");
	const target = to;
	const selectedMember =
		target === "team"
			? undefined
			: recipients.find((member) => member.name === target);
	const recipientResolved = target === "team" || !!selectedMember;
	const recipientSupportsInterrupt = selectedMember?.agentId === "codex";
	const canInterrupt =
		deliveryModesSupported && interruptSupported && recipientSupportsInterrupt;
	const modeUnavailable = draft.deliveryMode === "interrupt" && !canInterrupt;
	const validTarget =
		target === "team" || recipients.some((member) => member.name === target);
	useEffect(() => {
		if (
			recipientResolved &&
			!recipientSupportsInterrupt &&
			draft.deliveryMode === "interrupt"
		)
			store.edit(targetScope, { deliveryMode: "queue" });
	}, [
		recipientResolved,
		recipientSupportsInterrupt,
		draft.deliveryMode,
		store,
		targetScope,
	]);
	const interruptHint = !recipientSupportsInterrupt
		? t({
				message:
					"Safe interruption is only supported for Codex sessions. Messages to other agents or the whole team are queued.",
			})
		: !canInterrupt
			? t({
					message:
						"Safe interruption is unavailable on this host. Queued mail waits for the agent; sending does not confirm consumption.",
				})
			: t({
					message:
						"Queue waits for the agent. Interrupt requires safe support from the current Codex session. Both require recipient acknowledgement; sending is not consumption.",
				});
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
			className="mx-auto mt-3 flex w-full max-w-4xl shrink-0 flex-col gap-2 rounded-xl border border-border/80 bg-card/90 p-3 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
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
				className="field-sizing-content min-h-10 max-h-40 w-full resize-none overflow-y-auto bg-transparent px-0.5 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-50"
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
			<div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<JedvSelect
						label={t({ message: "Mail recipient" })}
						value={target}
						onValueChange={(nextTo) => {
							if (!nextTo) return;
							const nextMember =
								nextTo === "team"
									? undefined
									: recipients.find((member) => member.name === nextTo);
							const nextCanInterrupt =
								deliveryModesSupported &&
								interruptSupported &&
								nextMember?.agentId === "codex";
							setCapacityError(
								!store.edit(targetScope, {
									to: nextTo,
									...(draft.deliveryMode === "interrupt" && !nextCanInterrupt
										? { deliveryMode: "queue" }
										: {}),
								}),
							);
						}}
						disabled={disabled || locked}
						options={[
							{ value: "team", label: t({ message: "Whole team" }) },
							...recipients.map((member) => ({
								value: member.name,
								label: member.name,
							})),
						]}
						className="h-7.5 max-w-44 shrink-0 rounded-lg border-border/70 bg-secondary/55 px-3 text-xs font-medium"
					/>
					<Tooltip>
						<TooltipTrigger asChild>
							<select
								aria-label={t({ message: "Delivery mode" })}
								className="h-7.5 rounded-lg border border-border/70 bg-secondary/55 px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
								value={draft.deliveryMode}
								disabled={disabled || locked}
								onChange={(event) =>
									setCapacityError(
										!store.edit(targetScope, {
											deliveryMode:
												event.target.value === "interrupt"
													? "interrupt"
													: "queue",
										}),
									)
								}
							>
								<option value="queue">{t({ message: "Queue message" })}</option>
								<option
									value="interrupt"
									disabled={!canInterrupt}
									title={!canInterrupt ? interruptHint : undefined}
								>
									{t({ message: "Interrupt now" })}
								</option>
							</select>
						</TooltipTrigger>
						{!canInterrupt && (
							<TooltipContent className="max-w-xs">
								{interruptHint}
							</TooltipContent>
						)}
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								type="button"
								aria-label={t({ message: "Mail delivery info" })}
								className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/80 transition-colors hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							>
								<LuInfo className="size-3.5" />
							</button>
						</TooltipTrigger>
						<TooltipContent className="max-w-xs">
							{interruptHint}
						</TooltipContent>
					</Tooltip>
				</div>
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
					className="size-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:opacity-40"
				>
					<LuArrowUp className="size-4" />
				</TeamIconButton>
			</div>
			{capacityError && (
				<p role="alert" className="text-xs text-destructive">
					<Trans>Unavailable</Trans>
				</p>
			)}
		</form>
	);
}
