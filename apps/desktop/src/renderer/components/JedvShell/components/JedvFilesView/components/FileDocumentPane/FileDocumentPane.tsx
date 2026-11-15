import { Button } from "@jedv/ui/button";
import { Trans } from "@lingui/react/macro";
import { useSyncExternalStore } from "react";
import type { LocalClient } from "renderer/components/JedvShell/local-client";
import { getPathDirectory } from "shared/absolute-paths";
import { LARGE_FILE_MAX_BYTES } from "../../state/fileDocumentStore/fileDocumentStore";
import type { SharedFileDocument } from "../../state/fileDocumentStore/types";
import type { ViewProps } from "../../types";
import { withinWorkspace } from "../../utils/workspace-path";
import { CodeView } from "../CodeView";
import { ExternalChangeBanner } from "../ExternalChangeBanner";
import { FileSaveConflictDialog } from "../FileSaveConflictDialog";
import { MarkdownPreviewView } from "../MarkdownPreviewView";
import { MarkdownResourceProvider } from "../MarkdownRenderer/providers/MarkdownResourceProvider";
import { OrphanedBanner } from "../OrphanedBanner";
import { SaveErrorBanner } from "../SaveErrorBanner";

export function FileDocumentPane({
	document,
	preview,
	active,
	rootPath,
	client,
	decodeBase64,
	onOpenUrl,
}: {
	document: SharedFileDocument;
	preview: boolean;
	active: boolean;
	rootPath: string;
	client: LocalClient;
	decodeBase64: (value: string) => Uint8Array;
	onOpenUrl?: ViewProps["onOpenUrl"];
}) {
	useSyncExternalStore(document.subscribe, document.getVersion);
	const content = document.content;
	const View = preview ? MarkdownPreviewView : CodeView;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<FileSaveConflictDialog
				open={document.conflict !== null && active}
				filePath={document.absolutePath}
				localContent={content.kind === "text" ? content.value : ""}
				diskContent={document.conflict?.diskContent ?? null}
				isSaving={document.pendingSave}
				onOpenChange={(open) => {
					if (!open) void document.resolveConflict("keep");
				}}
				onKeepEditing={() => void document.resolveConflict("keep")}
				onReloadFromDisk={() => void document.resolveConflict("reload")}
				onOverwrite={() => void document.resolveConflict("overwrite")}
			/>
			{document.hasExternalChange && !document.orphaned && (
				<ExternalChangeBanner
					onCompare={() => void document.compareWithDisk()}
				/>
			)}
			{document.orphaned && (
				<OrphanedBanner
					dirty={document.dirty}
					onDiscard={() => void document.reload()}
				/>
			)}
			{document.saveError && (
				<SaveErrorBanner
					message={document.saveError.message}
					onRetry={() => void document.save()}
					onDismiss={() => document.clearSaveError()}
				/>
			)}
			{content.kind === "text" && !document.isBinary ? (
				<div className="min-h-0 flex-1">
					<MarkdownResourceProvider
						documentDirectory={getPathDirectory(document.absolutePath)}
						rootPath={rootPath}
						revision={content.revision}
						readFile={async (absolutePath) => {
							if (!withinWorkspace(rootPath, absolutePath))
								throw new Error("Resource is outside the workspace");
							const result = await client.filesystem.readFile.query({
								workspaceId: document.workspaceId,
								absolutePath,
								maxBytes: 5 * 1024 * 1024,
							});
							if (result.exceededLimit)
								throw new Error("Image exceeds the preview limit");
							return result.kind === "bytes"
								? decodeBase64(result.content)
								: new TextEncoder().encode(result.content);
						}}
					>
						<View
							document={document}
							filePath={document.absolutePath}
							workspaceId={document.workspaceId}
							paneId={document.id}
							isActive={active}
							onOpenUrl={onOpenUrl}
						/>
					</MarkdownResourceProvider>
				</div>
			) : (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
					{content.kind === "loading" ? (
						<Trans>Loading file…</Trans>
					) : content.kind === "too-large" ? (
						<div className="max-w-sm space-y-3 text-center">
							<p>
								<Trans>
									This is a large file. Opening it may slow down the editor.
								</Trans>
							</p>
							{document.byteSize !== null &&
							document.byteSize <= LARGE_FILE_MAX_BYTES ? (
								<Button
									variant="outline"
									onClick={() => void document.loadLargeFile()}
								>
									<Trans>Open large file</Trans>
								</Button>
							) : (
								<p>
									<Trans>
										Files larger than 32 MiB must be opened in an external
										editor.
									</Trans>
								</p>
							)}
						</div>
					) : content.kind === "error" ? (
						<span role="alert">{content.error.message}</span>
					) : content.kind === "not-found" ? (
						<Trans>File not found</Trans>
					) : (
						<Trans>This file cannot be edited as text.</Trans>
					)}
					{content.kind !== "loading" && (
						<Button variant="outline" onClick={() => void document.reload()}>
							<Trans>Reload</Trans>
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
