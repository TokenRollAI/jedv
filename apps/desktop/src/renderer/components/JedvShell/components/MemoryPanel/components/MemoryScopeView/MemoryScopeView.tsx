import type { MemoryPut } from "@jedv/shared/memory";
import { Button } from "@jedv/ui/button";
import { Input } from "@jedv/ui/input";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { LuPlus, LuRefreshCw, LuSearch, LuX } from "react-icons/lu";
import {
	type Confirmation,
	JedvConfirmDialog,
} from "../../../JedvConfirmDialog/JedvConfirmDialog";
import { JedvIconButton } from "../../../JedvIconButton";
import { JedvSelect } from "../../../JedvSelect";
import {
	type MemoryItem,
	type MemoryPanelProps,
	type MemoryScopeOption,
	memoryKey,
} from "../../types";
import { MemoryEditor } from "../MemoryEditor";
import { MemoryReview } from "../MemoryReview";
import { MemoryRow } from "../MemoryRow";
import { MemoryTransfer } from "../MemoryTransfer";
export function MemoryScopeView({
	client,
	hostUrl,
	scope,
	scopeSelector,
	readOnly = false,
	disabled = false,
}: Omit<MemoryPanelProps, "scopes"> & {
	scope: MemoryScopeOption;
	scopeSelector: ReactNode;
}) {
	const { t } = useLingui();
	const cache = useQueryClient();
	const [searchDraft, setSearchDraft] = useState(""),
		[search, setSearch] = useState("");
	const [tier, setTier] = useState("core");
	const [editor, setEditor] = useState<{ initial?: MemoryItem } | null>(null);
	const [candidate, setCandidate] = useState<MemoryItem | null>(null);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [failed, setFailed] = useState(false);
	const capabilities = useQuery({
		queryKey: [...memoryKey(hostUrl), "capabilities"],
		queryFn: () => client.memory.capabilities.query(),
		enabled: !disabled,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 30_000,
	});
	const supported =
		capabilities.data?.protocolVersion === 1 && !capabilities.isError;
	const target = { scopeKind: scope.scopeKind, scopeId: scope.scopeId };
	const list = useQuery({
		queryKey: [...memoryKey(hostUrl), "list", target],
		queryFn: () =>
			client.memory.list.query({
				...target,
				includeCandidates: true,
				limit: 500,
			}),
		enabled: supported && !disabled,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 15_000,
	});
	const results = useQuery({
		queryKey: [...memoryKey(hostUrl), "search", target, search],
		queryFn: () =>
			client.memory.search.query({ ...target, query: search, limit: 100 }),
		enabled: supported && !disabled && !!search,
		retry: false,
		gcTime: 30_000,
	});
	const refresh = () =>
		cache.invalidateQueries({ queryKey: memoryKey(hostUrl) });
	const writable = supported && !disabled && !readOnly && !list.isError;
	type Action =
		| { kind: "put"; value: MemoryPut }
		| { kind: "remove"; id: string }
		| {
				kind: "review";
				id: string;
				action: "accept" | "reject";
				supersedeId?: string;
		  };
	const action = useMutation({
		mutationFn: async (input: Action) => {
			if (!writable) throw new Error("Memory is read-only");
			if (input.kind === "put") return client.memory.put.mutate(input.value);
			if (input.kind === "remove")
				return client.memory.remove.mutate({ id: input.id });
			return client.memory.reviewCandidate.mutate({
				id: input.id,
				action: input.action,
				supersedeId: input.supersedeId,
			});
		},
		onMutate: () => setFailed(false),
		onSuccess: refresh,
		onError: () => setFailed(true),
	});
	const query = search ? results : list;
	const entries = (query.data ?? []).filter(
		(item) =>
			item.scopeKind === scope.scopeKind &&
			item.scopeId === scope.scopeId &&
			!item.supersededById &&
			(item.status === "active" || item.status === "candidate"),
	);
	const visible = entries.filter((item) => item.tier === tier);
	const budget =
		scope.scopeKind === "global"
			? 1200
			: scope.scopeKind === "project"
				? 2000
				: 1600;
	const requestRemove = (item: MemoryItem) =>
		setConfirmation({
			title: t({ message: "Remove memory?" }),
			description: t({
				message: "This entry will no longer be searched or injected.",
			}),
			detail: `${scope.label}\n${item.title}`,
			execute: async () => {
				await action.mutateAsync({ kind: "remove", id: item.id });
			},
		});
	const review = (item: MemoryItem, decision: "accept" | "reject") => {
		if (decision === "accept") setCandidate(item);
		else
			setConfirmation({
				title: t({ message: "Reject candidate?" }),
				description: t({
					message: "This entry will no longer be searched or injected.",
				}),
				detail: item.title,
				execute: async () => {
					await action.mutateAsync({
						kind: "review",
						id: item.id,
						action: "reject",
					});
				},
			});
	};
	return (
		<section
			className="flex min-h-0 flex-1 flex-col"
			aria-label={t({ message: "Memory" })}
		>
			<div className="flex shrink-0 flex-wrap items-center gap-2 py-2">
				{scopeSelector}
				<JedvSelect
					label={t({ message: "Tier" })}
					value={tier}
					onValueChange={setTier}
					options={[
						{ value: "core", label: t({ message: "Core" }) },
						{ value: "archival", label: t({ message: "Archival" }) },
					]}
					className="w-auto"
				/>
				<form
					className="ml-auto flex min-w-0 items-center gap-1"
					onSubmit={(event) => {
						event.preventDefault();
						setSearch(searchDraft.trim());
					}}
				>
					<Input
						aria-label={t({ message: "Search memory" })}
						placeholder={t({ message: "Search active memory…" })}
						maxLength={500}
						value={searchDraft}
						onChange={(event) => setSearchDraft(event.target.value)}
						className="h-7 w-36 text-xs"
					/>
					<JedvIconButton
						label={t({ message: "Search memory" })}
						type="submit"
						disabled={!supported || disabled}
					>
						<LuSearch className="size-3.5" />
					</JedvIconButton>
					{search && (
						<JedvIconButton
							label={t({ message: "Clear search" })}
							onClick={() => {
								setSearchDraft("");
								setSearch("");
							}}
						>
							<LuX className="size-3.5" />
						</JedvIconButton>
					)}
				</form>
				<MemoryTransfer
					client={client}
					hostUrl={hostUrl}
					scope={scope}
					disabled={!writable || action.isPending}
					canExport={supported && !disabled}
					onChanged={refresh}
				/>
				<JedvIconButton
					label={t({ message: "Add memory" })}
					disabled={!writable || action.isPending}
					onClick={() => setEditor({})}
				>
					<LuPlus className="size-3.5" />
				</JedvIconButton>
				<JedvIconButton
					label={t({ message: "Refresh" })}
					disabled={query.isFetching || capabilities.isFetching}
					onClick={() => {
						void capabilities.refetch();
						void refresh();
					}}
				>
					<LuRefreshCw className="size-3.5" />
				</JedvIconButton>
			</div>
			{readOnly && (
				<p className="shrink-0 py-1 text-[11px] text-muted-foreground">
					<Trans>Archived team · read-only</Trans>
				</p>
			)}
			{(failed ||
				capabilities.isError ||
				list.isError ||
				results.isError ||
				disabled ||
				(capabilities.isSuccess && !supported)) && (
				<div
					role="alert"
					className="my-2 flex shrink-0 items-center gap-2 rounded border border-destructive/30 p-2 text-xs text-destructive"
				>
					<span className="flex-1">
						{!supported || disabled
							? t({ message: "Memory is unavailable on this host." })
							: t({ message: "Memory action failed" })}
					</span>
					<Button
						size="sm"
						variant="ghost"
						disabled={action.isPending || disabled}
						onClick={() => {
							setFailed(false);
							void capabilities.refetch();
							void refresh();
						}}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			<div
				className="min-h-0 flex-1 overflow-y-auto"
				aria-busy={query.isFetching}
			>
				{(!disabled && capabilities.isPending) ||
				(supported && !disabled && query.isPending) ? (
					<output className="block py-8 text-center text-xs text-muted-foreground">
						<Trans>Loading memory…</Trans>
					</output>
				) : visible.length ? (
					visible.map((item) => (
						<MemoryRow
							key={item.id}
							item={item}
							disabled={!writable || action.isPending}
							onEdit={() => setEditor({ initial: item })}
							onRemove={() => requestRemove(item)}
							onReview={(decision) => review(item, decision)}
						/>
					))
				) : (
					supported &&
					!query.isError && (
						<p className="py-8 text-center text-xs text-muted-foreground">
							<Trans>No memory found</Trans>
						</p>
					)
				)}
			</div>
			<p className="shrink-0 border-t border-border py-2 text-[10px] text-muted-foreground">
				<Trans>
					Core injection: {budget} characters in this scope, 4800 total.
					Candidates are excluded.
				</Trans>
			</p>
			{editor && !readOnly && supported && (
				<MemoryEditor
					disabled={!writable}
					scope={scope}
					initial={editor.initial}
					onClose={() => setEditor(null)}
					onSave={async (value) => {
						await action.mutateAsync({ kind: "put", value });
					}}
				/>
			)}
			{candidate && writable && (
				<MemoryReview
					candidate={candidate}
					entries={list.data ?? []}
					onClose={() => setCandidate(null)}
					onAccept={async (supersedeId) => {
						await action.mutateAsync({
							kind: "review",
							id: candidate.id,
							action: "accept",
							supersedeId,
						});
					}}
				/>
			)}
			{confirmation && writable && (
				<JedvConfirmDialog
					confirmation={confirmation}
					onClose={() => setConfirmation(null)}
				/>
			)}
		</section>
	);
}
