import { Button } from "@jedv/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@jedv/ui/dropdown-menu";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Bot, LoaderCircle, Pencil, Plus, RefreshCw } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import {
	findTerminalPane,
	paneTerminalId,
	switchTerminalSession,
	workspaceAreaStores,
} from "../../../JedvTerminalWorkspace/layout";
import type {
	SessionBinding,
	SessionPickerContext,
	TerminalSessionsMenuProps,
} from "../../types";
import {
	type SessionContinuation,
	sessionContinuation,
	terminalSessionRows,
} from "../../utils/session-list";
import { ContinueSessionDialog } from "../ContinueSessionDialog";
import { RenameSessionDialog } from "../RenameSessionDialog";
import { SessionLaunchDialog } from "../SessionLaunchDialog";
import { TerminalSessionMenuRow } from "../TerminalSessionMenuRow";

type Scope = {
	paneId?: string;
	terminalId: string | null;
	store: TerminalSessionsMenuProps["store"];
	picker?: SessionPickerContext;
};
type OpenDialog = { scope: Scope } & (
	| { kind: "rename"; terminalId: string; initialName: string }
	| { kind: "continue"; title: string; continuation: SessionContinuation }
	| { kind: "launch"; props: TerminalSessionsMenuProps }
);
export function useTerminalSessionsMenu(
	props: TerminalSessionsMenuProps,
	standalone = false,
	trigger?: (
		session: TerminalSessionsMenuProps["sessions"][number] | undefined,
		binding: SessionBinding | undefined,
		display: { bindingFresh: boolean },
	) => ReactNode,
) {
	const { t } = useLingui();
	const { store, sessionPicker, activeId, targetPaneId } = props;
	const otherArea =
		workspaceAreaStores(store).find((area) => area !== store) ?? store;
	useStore(otherArea, (state) => state.tabs);
	useStore(store, (state) => state.tabs);
	const [open, setOpen] = useState(false);
	const [dialog, setDialog] = useState<OpenDialog | null>(null);
	const scope = useRef<Scope>({
		store,
		picker: sessionPicker,
		paneId: targetPaneId,
		terminalId: activeId,
	});
	scope.current = {
		store,
		picker: sessionPicker,
		paneId: targetPaneId,
		terminalId: activeId,
	};
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const isCurrent = (original: Scope) =>
		alive.current &&
		original.store === scope.current.store &&
		original.picker?.client === scope.current.picker?.client &&
		original.picker?.hostUrl === scope.current.picker?.hostUrl &&
		original.picker?.workspaceId === scope.current.picker?.workspaceId &&
		original.paneId === scope.current.paneId &&
		(!original.paneId ||
			paneTerminalId(
				original.store.getState().getPane(original.paneId)?.pane,
			) === original.terminalId);
	const previousScope = useRef({
		paneId: targetPaneId,
		terminalId: activeId,
		store,
		client: sessionPicker?.client,
		hostUrl: sessionPicker?.hostUrl,
		workspaceId: sessionPicker?.workspaceId,
	});
	useEffect(() => {
		const previous = previousScope.current;
		if (
			previous.paneId !== targetPaneId ||
			(targetPaneId && previous.terminalId !== activeId) ||
			previous.store !== store ||
			previous.client !== sessionPicker?.client ||
			previous.hostUrl !== sessionPicker?.hostUrl ||
			previous.workspaceId !== sessionPicker?.workspaceId
		)
			setOpen(false);
		previousScope.current = {
			paneId: targetPaneId,
			terminalId: activeId,
			store,
			client: sessionPicker?.client,
			hostUrl: sessionPicker?.hostUrl,
			workspaceId: sessionPicker?.workspaceId,
		};
	}, [
		targetPaneId,
		activeId,
		store,
		sessionPicker?.client,
		sessionPicker?.hostUrl,
		sessionPicker?.workspaceId,
	]);
	const pending = useRef<(() => void) | null>(null);
	const defer = (action: () => void) => {
		const original = scope.current;
		pending.current = () => {
			if (isCurrent(original)) action();
		};
		setOpen(false);
	};
	const query = useQuery({
		queryKey: [
			"jedv",
			sessionPicker?.hostUrl,
			"terminals",
			sessionPicker?.workspaceId,
		],
		queryFn: () =>
			sessionPicker
				? sessionPicker.client.terminal.list.query({
						workspaceId: sessionPicker.workspaceId,
					})
				: Promise.resolve({ sessions: props.sessions }),
		initialData: sessionPicker ? { sessions: props.sessions } : undefined,
		enabled: open && !!sessionPicker,
		refetchInterval: open && sessionPicker ? 2000 : false,
		retry: false,
	});
	const bindings = useQuery({
		queryKey: [
			"jedv",
			sessionPicker?.hostUrl,
			sessionPicker?.workspaceId,
			"native-bindings",
		],
		queryFn: () =>
			sessionPicker
				? sessionPicker.client.terminalAgents.listByWorkspace.query({
						workspaceId: sessionPicker.workspaceId,
					})
				: Promise.resolve([]),
		enabled: open && !!sessionPicker,
		refetchInterval: open && sessionPicker ? 3000 : false,
		retry: false,
	});
	const candidates = useQuery({
		queryKey: [
			"jedv",
			sessionPicker?.hostUrl,
			sessionPicker?.workspaceId,
			"resume-candidates",
		],
		queryFn: () =>
			sessionPicker
				? sessionPicker.client.terminalAgents.resumeCandidates.query({
						workspaceId: sessionPicker.workspaceId,
					})
				: Promise.resolve([]),
		enabled: open && !!sessionPicker,
		retry: false,
	});
	const sessions = sessionPicker
		? (query.data?.sessions ?? props.sessions).filter(
				(row) => row.workspaceId === sessionPicker.workspaceId,
			)
		: props.sessions;
	const rows = terminalSessionRows(sessions, store, activeId);
	const current = rows.find((row) => row.current);
	const currentBinding = bindings.data?.find(
		(binding) => binding.terminalId === activeId && binding.endedAt == null,
	);
	const currentContinuation = current
		? sessionContinuation(
				current.session,
				bindings.data ?? [],
				candidates.data ?? [],
			)
		: null;
	const failures = [query.error, bindings.error, candidates.error].filter(
		Boolean,
	);
	const refresh = () =>
		void Promise.all([
			query.refetch(),
			bindings.refetch(),
			candidates.refetch(),
		]);
	const showContinue = (title: string, continuation: SessionContinuation) => {
		const original = scope.current;
		defer(() =>
			setDialog({ kind: "continue", scope: original, title, continuation }),
		);
	};
	useEffect(() => {
		if (open || !pending.current) return;
		const action = pending.current;
		pending.current = null;
		const frame = requestAnimationFrame(action);
		return () => cancelAnimationFrame(frame);
	}, [open]);
	const Root = standalone ? DropdownMenu : DropdownMenuSub;
	const Content = standalone ? DropdownMenuContent : DropdownMenuSubContent;
	const Trigger = standalone ? DropdownMenuTrigger : DropdownMenuSubTrigger;
	return {
		props,
		menu: (
			<Root open={open} onOpenChange={setOpen}>
				<Trigger asChild={standalone}>
					{standalone ? (
						(trigger?.(current?.session, currentBinding, {
							bindingFresh:
								open &&
								bindings.isSuccess &&
								!bindings.isFetching &&
								!bindings.isRefetchError,
						}) ?? (
							<button type="button">
								<Trans>Terminal sessions</Trans>
							</button>
						))
					) : (
						<Trans>Terminal sessions</Trans>
					)}
				</Trigger>
				<Content className="w-96 max-w-[calc(100vw-2rem)]">
					<DropdownMenuItem
						disabled={!props.enabled}
						onSelect={() => defer(props.onNew)}
					>
						<Plus className="size-3.5" />
						<Trans>New Terminal</Trans>
					</DropdownMenuItem>
					{current && sessionPicker && (
						<DropdownMenuItem
							disabled={!props.enabled}
							onSelect={() => {
								const original = scope.current;
								defer(() =>
									setDialog({
										kind: "rename",
										scope: original,
										terminalId: current.session.terminalId,
										initialName: current.session.customTitle ?? "",
									}),
								);
							}}
						>
							<Pencil className="size-3.5" />
							<Trans>Rename session</Trans>
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
						<span className="flex-1">
							<Trans>Terminal sessions</Trans>
						</span>
						{query.isFetching && (
							<LoaderCircle className="size-3 animate-spin" />
						)}
						{sessionPicker && (
							<Button
								size="sm"
								variant="ghost"
								className="h-5 px-1"
								disabled={
									query.isFetching ||
									bindings.isFetching ||
									candidates.isFetching
								}
								aria-label={t({ message: "Refresh sessions" })}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									refresh();
								}}
							>
								<RefreshCw className="size-3" />
							</Button>
						)}
					</DropdownMenuLabel>
					{failures.length > 0 && (
						<p role="alert" className="px-2 py-1 text-xs text-destructive">
							<Trans>
								Some session details could not be loaded. Refresh to check the
								current host state.
							</Trans>
						</p>
					)}
					<div
						className="max-h-80 overflow-y-auto overscroll-contain"
						data-terminal-session-list
					>
						{rows.length === 0 && (
							<p className="px-2 py-2 text-xs text-muted-foreground">
								<Trans>No terminal sessions</Trans>
							</p>
						)}
						{rows.map((row) => {
							const title = row.title || t({ message: "Terminal" });
							const binding = bindings.data?.find(
								(item) =>
									item.terminalId === row.session.terminalId &&
									item.endedAt == null,
							);
							const continuation = sessionContinuation(
								row.session,
								bindings.data ?? [],
								candidates.data ?? [],
							);
							return (
								<TerminalSessionMenuRow
									key={row.session.terminalId}
									{...row}
									title={title}
									binding={binding}
									disabled={
										!props.enabled ||
										Boolean(targetPaneId && row.attached && !row.current)
									}
									killable={!targetPaneId || !row.attached}
									canContinue={!!sessionPicker && !!continuation}
									onSelect={() =>
										defer(() => {
											if (
												switchTerminalSession(store, row.session, targetPaneId)
											)
												props.onAttach(row.session.terminalId);
										})
									}
									onKill={() => {
										const original = scope.current;
										defer(() =>
											targetPaneId
												? props.onKill(
														row.session.terminalId,
														() =>
															isCurrent(original) &&
															!findTerminalPane(store, row.session.terminalId),
													)
												: props.onKill(row.session.terminalId),
										);
									}}
									onRename={
										sessionPicker
											? () => {
													const original = scope.current;
													defer(() =>
														setDialog({
															kind: "rename",
															scope: original,
															terminalId: row.session.terminalId,
															initialName: row.session.customTitle ?? "",
														}),
													);
												}
											: undefined
									}
									onContinue={() => {
										if (continuation) showContinue(title, continuation);
									}}
								/>
							);
						})}
					</div>
					<DropdownMenuSeparator />
					{currentContinuation && (
						<DropdownMenuItem
							disabled={!props.enabled}
							onSelect={() =>
								showContinue(
									current?.title || t({ message: "Terminal" }),
									currentContinuation,
								)
							}
						>
							<Bot className="size-3.5" />
							<Trans>Continue with agent…</Trans>
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						disabled={!props.enabled}
						onSelect={() => {
							const original = scope.current;
							defer(() =>
								setDialog({ kind: "launch", scope: original, props }),
							);
						}}
					>
						<Bot className="size-3.5" />
						<Trans>Run agent…</Trans>
					</DropdownMenuItem>
				</Content>
			</Root>
		),
		dialogs: (
			<>
				{dialog?.kind === "continue" && dialog.scope.picker && (
					<ContinueSessionDialog
						target={dialog.scope.picker}
						continuation={dialog.continuation}
						title={dialog.title}
						isCurrent={() => isCurrent(dialog.scope)}
						onClose={() => setDialog(null)}
					/>
				)}
				{dialog?.kind === "rename" && dialog.scope.picker && (
					<RenameSessionDialog
						target={dialog.scope.picker}
						terminalId={dialog.terminalId}
						initialName={dialog.initialName}
						store={dialog.scope.store}
						isCurrent={() => isCurrent(dialog.scope)}
						onClose={() => setDialog(null)}
					/>
				)}
				{dialog?.kind === "launch" && (
					<SessionLaunchDialog
						target={
							dialog.scope.picker
								? {
										...dialog.scope.picker,
										onSelectSession: async (selection) => {
											if (isCurrent(dialog.scope)) {
												await dialog.scope.picker?.onSelectSession(selection);
												setDialog(null);
											}
										},
									}
								: undefined
						}
						configs={dialog.props.configs}
						disabled={!props.enabled || !isCurrent(dialog.scope)}
						onLaunch={(config) => {
							if (isCurrent(dialog.scope)) {
								setDialog(null);
								requestAnimationFrame(() => {
									if (isCurrent(dialog.scope)) dialog.props.onLaunch(config);
								});
							}
						}}
						onSettings={() => {
							setDialog(null);
							if (isCurrent(dialog.scope)) dialog.props.onSettings();
						}}
						onClose={() => setDialog(null)}
					/>
				)}
			</>
		),
	};
}
