import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { LuUsers } from "react-icons/lu";
import type { useTeamwork } from "../../hooks/useTeamwork";
import type { JedvParityViewContext } from "../../parity-types";
import { DeclarativeDataSlots } from "../DeclarativeDataSlots";
import {
	WindowChrome,
	WindowChromeControls,
	WindowChromeLeading,
	WindowControlsInset,
} from "../WindowChrome";
import { TeamDetail } from "./components/TeamDetail";
import { teamMailDrafts } from "./team-mail-drafts";
export function JedvTeamworkView({
	context,
	index,
	connected,
	selectedId,
	onCreate,
}: {
	context: JedvParityViewContext;
	index: ReturnType<typeof useTeamwork>;
	connected: boolean;
	selectedId: string | null;
	onCreate(): void;
}) {
	const { t } = useLingui();
	useEffect(() => {
		if (
			context.logicalHostId &&
			connected &&
			index.list.isSuccess &&
			!index.list.isError
		)
			teamMailDrafts.reconcile(
				context.logicalHostId,
				new Set(
					index.list.data
						.filter((team) => team.status !== "archived")
						.map((team) => team.id),
				),
			);
	}, [
		context.logicalHostId,
		connected,
		index.list.isSuccess,
		index.list.isError,
		index.list.data,
	]);
	const selected =
		index.list.data?.find((team) => team.id === selectedId) ??
		index.list.data?.find((team) => team.status !== "archived");
	const oldHost =
		(index.capabilities.error as { data?: { code?: string } } | null)?.data
			?.code === "NOT_FOUND" ||
		(index.capabilities.isSuccess &&
			index.capabilities.data.protocolVersion !== 1);
	const failed =
		!connected || index.capabilities.isError || index.list.isError || oldHost;
	const loading =
		index.capabilities.isPending || (index.supported && index.list.isPending);
	// Cached protocol/data keep drafts and retry identities mounted during transient failures.
	if (selected && index.capabilities.data?.protocolVersion === 1)
		return (
			<TeamDetail
				key={`${context.hostUrl}:${selected.id}`}
				context={context}
				teamId={selected.id}
				title={selected.name}
				connected={index.supported && !failed}
				deleteSupported={index.capabilities.data?.features?.delete === true}
				interruptSupported={
					(
						index.capabilities.data?.features as
							| { mailInterrupt?: boolean }
							| undefined
					)?.mailInterrupt === true
				}
				deliveryModesSupported={
					(
						index.capabilities.data?.features as
							| { mailDeliveryModes?: boolean }
							| undefined
					)?.mailDeliveryModes === true
				}
			/>
		);
	return (
		<section
			className="flex h-full min-h-0 flex-col bg-background"
			aria-label={t({ message: "Teamwork" })}
		>
			<WindowChrome primary className="gap-2 border-b border-border pr-3">
				<WindowChromeLeading />
				<WindowChromeControls className="min-w-0 pl-3">
					<h1 className="flex items-center gap-2 text-[13.5px] font-medium">
						<LuUsers className="size-4 text-muted-foreground" />
						<Trans>Teamwork</Trans>
					</h1>
				</WindowChromeControls>
				<div className="drag min-w-0 flex-1" />
				<DeclarativeDataSlots
					context={context}
					surface="teamwork.header"
					teamId={selected?.id}
					connected={connected}
				/>
				<WindowControlsInset />
			</WindowChrome>
			<div className="flex min-h-0 flex-1 flex-col px-5 py-4">
				{failed && (
					<div
						role="alert"
						className="mb-3 rounded border border-destructive/30 p-3 text-xs text-destructive"
					>
						{oldHost
							? t({
									message:
										"This host does not support Teamwork. Update the host to use teams and mail.",
								})
							: !connected
								? t({
										message:
											"Host offline. Team actions are unavailable until the connection is restored.",
									})
								: t({
										message:
											"Could not load Teamwork. Check the host connection and retry.",
									})}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								void index.capabilities.refetch();
								void index.list.refetch();
							}}
						>
							<Trans>Retry</Trans>
						</Button>
					</div>
				)}
				{!failed && loading ? (
					<output className="py-12 text-center text-xs text-muted-foreground">
						<Trans>Loading teams…</Trans>
					</output>
				) : (
					!failed && (
						<div className="m-auto max-w-sm space-y-2 text-center">
							<LuUsers className="mx-auto size-7 text-muted-foreground" />
							<p className="text-sm font-medium">
								<Trans>No teams yet</Trans>
							</p>
							<Button variant="outline" size="sm" onClick={onCreate}>
								<Trans>Create team</Trans>
							</Button>
						</div>
					)
				)}
			</div>
		</section>
	);
}
