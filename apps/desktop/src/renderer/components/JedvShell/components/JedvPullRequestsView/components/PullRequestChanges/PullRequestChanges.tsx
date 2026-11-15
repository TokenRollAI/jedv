import { errorMessage } from "@jedv/i18n/errors";
import type { PullRequestReviewThread } from "@jedv/shared/pull-request-threads";
import { Button } from "@jedv/ui/button";
import { Trans, useLingui } from "@lingui/react/macro";
import type { CodeViewItem, DiffLineAnnotation } from "@pierre/diffs";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIsDarkTheme } from "renderer/assets/app-icons/preset-icons";
import type { LocalClient } from "../../../../local-client";
import type { PullRequestTarget } from "../../types";
import { ReviewThread } from "./components/ReviewThread/ReviewThread";
import { parsePullRequestPatch } from "./utils/parse-patch";
export function PullRequestChanges({
	client,
	hostUrl,
	target,
	canUpdate,
	onUpdated,
}: {
	client: LocalClient;
	hostUrl: string;
	target: PullRequestTarget;
	canUpdate: boolean;
	onUpdated(): Promise<void>;
}) {
	const { t } = useLingui();
	const dark = useIsDarkTheme();
	const [split, setSplit] = useState(false);
	const threadUi = useRef(
		new Map<string, { reply: string; expanded: boolean; blocked?: boolean }>(),
	);
	const view = useRef<CodeViewHandle<PullRequestReviewThread, undefined>>(null);
	const diff = useQuery({
		queryKey: [
			"jedv",
			hostUrl,
			"pr-diff",
			target.owner,
			target.repo,
			target.number,
		],
		queryFn: () =>
			client.pullRequests.getDiffByRepo.query({
				repoFullName: `${target.owner}/${target.repo}`,
				prNumber: target.number,
			}),
		retry: false,
	});
	const threads = useQuery({
		queryKey: ["jedv", hostUrl, "pr-threads", target.projectId, target.number],
		queryFn: () =>
			client.pullRequests.getThreads.query({
				projectId: target.projectId,
				prNumber: target.number,
			}),
		retry: false,
	});
	useEffect(() => {
		if (!threads.data || threads.data.fetchFailed) return;
		const live = new Set(threads.data.reviewThreads.map((thread) => thread.id));
		for (const id of threadUi.current.keys())
			if (!live.has(id)) threadUi.current.delete(id);
	}, [threads.data]);
	const viewer = useQuery({
		queryKey: ["jedv", hostUrl, "github-viewer"],
		queryFn: () => client.github.getUser.query(),
		retry: false,
		staleTime: 60000,
	});
	const annotations = useMemo(() => {
		const result = new Map<
			string,
			DiffLineAnnotation<PullRequestReviewThread>[]
		>();
		for (const thread of threads.data?.reviewThreads ?? []) {
			if (thread.line == null || !thread.path) continue;
			const list = result.get(thread.path) ?? [];
			list.push({
				side: thread.diffSide === "LEFT" ? "deletions" : "additions",
				lineNumber: thread.line,
				metadata: thread,
			});
			result.set(thread.path, list);
		}
		return result;
	}, [threads.data]);
	const parsed = useMemo(() => {
		try {
			return {
				files: diff.data ? parsePullRequestPatch(diff.data) : [],
				error: null,
			};
		} catch (cause) {
			return {
				files: [],
				error: errorMessage(
					cause,
					t({ message: "Failed to parse pull request diff" }),
				),
			};
		}
	}, [diff.data, t]);
	const items = useMemo<CodeViewItem<PullRequestReviewThread>[]>(
		() =>
			parsed.files.map((file, index) => ({
				id: `${file.name}-${index}`,
				type: "diff",
				annotations: annotations.get(file.name),
				version:
					diff.dataUpdatedAt +
					threads.dataUpdatedAt +
					viewer.dataUpdatedAt +
					Number(canUpdate),
				fileDiff: {
					...file,
					cacheKey: `${hostUrl}:${target.owner}/${target.repo}#${target.number}:${diff.dataUpdatedAt}:${index}`,
				},
			})),
		[
			parsed.files,
			hostUrl,
			target.owner,
			target.repo,
			target.number,
			diff.dataUpdatedAt,
			annotations,
			threads.dataUpdatedAt,
			viewer.dataUpdatedAt,
			canUpdate,
		],
	);
	if (diff.isPending)
		return (
			<output className="p-6 text-xs text-muted-foreground">
				<Trans>Loading changes…</Trans>
			</output>
		);
	if (diff.error || parsed.error)
		return (
			<div role="alert" className="p-6 text-xs text-destructive">
				{parsed.error ??
					errorMessage(diff.error, t({ message: "Failed to load changes" }))}
				<Button size="sm" variant="ghost" onClick={() => void diff.refetch()}>
					<Trans>Retry</Trans>
				</Button>
			</div>
		);
	if (items.length === 0)
		return (
			<p className="p-6 text-sm text-muted-foreground">
				<Trans>No file changes</Trans>
			</p>
		);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{viewer.error && (
				<div role="alert" className="px-3 py-2 text-xs text-destructive">
					{errorMessage(
						viewer.error,
						t({ message: "Could not load GitHub permissions" }),
					)}
					<Button
						size="sm"
						variant="ghost"
						onClick={() => void viewer.refetch()}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			{(threads.error || threads.data?.fetchFailed) && (
				<div
					role="alert"
					className="border-b border-destructive/20 px-3 py-2 text-xs text-destructive"
				>
					<Trans>Review threads could not be loaded</Trans>
					<Button
						size="sm"
						variant="ghost"
						onClick={() => void threads.refetch()}
					>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}
			<div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 text-xs text-muted-foreground">
				<span>
					<Trans>{items.length} changed files</Trans>
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 text-xs"
					onClick={() => setSplit((value) => !value)}
				>
					{split ? <Trans>Unified diff</Trans> : <Trans>Split diff</Trans>}
				</Button>
			</div>
			<div className="flex min-h-0 flex-1">
				<nav
					aria-label={t({ message: "Changed files" })}
					className="w-48 shrink-0 overflow-y-auto border-r border-border p-2 max-xl:hidden"
				>
					{parsed.files.map((file, index) => (
						<button
							key={`${file.name}-${index}`}
							type="button"
							title={file.name}
							onClick={() =>
								view.current?.scrollTo({
									type: "item",
									id: `${file.name}-${index}`,
									align: "start",
								})
							}
							className="block w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-[11px] text-muted-foreground hover:bg-accent"
						>
							{file.name}
						</button>
					))}
				</nav>
				<CodeView
					ref={view}
					className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain"
					items={items}
					renderAnnotation={(...[annotation]) =>
						annotation.metadata ? (
							<ReviewThread
								key={annotation.metadata.id}
								initialUi={threadUi.current.get(annotation.metadata.id)}
								onUiChange={(value) => {
									const id = annotation.metadata?.id;
									if (
										id &&
										(threadUi.current.has(id) || threadUi.current.size < 100)
									)
										threadUi.current.set(id, value);
								}}
								thread={annotation.metadata}
								client={client}
								target={target}
								viewerLogin={viewer.data?.login ?? null}
								canUpdate={canUpdate}
								onUpdated={async () => {
									const refreshed = await threads.refetch({
										throwOnError: true,
									});
									if (refreshed.data?.fetchFailed)
										throw new Error(
											t({ message: "Review threads could not be loaded" }),
										);
									await onUpdated();
								}}
							/>
						) : null
					}
					options={{
						diffStyle: split ? "split" : "unified",
						themeType: dark ? "dark" : "light",
						expandUnchanged: false,
						overflow: "wrap",
						stickyHeaders: true,
						tokenizeMaxLength: 200000,
						layout: { paddingTop: 0, paddingBottom: 8, gap: 0 },
						itemMetrics: { diffHeaderHeight: 32 },
						unsafeCSS: `[data-diffs-header='default']{border-top:1px solid var(--border);min-height:32px;height:32px;background:color-mix(in srgb,var(--muted) 40%,var(--background));}[data-diff]{--diffs-light-bg:var(--background)!important;--diffs-dark-bg:var(--background)!important;}[data-line-annotation]{white-space:normal;}`,
					}}
				/>
			</div>
		</div>
	);
}
