import { Button } from "@jedv/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "@jedv/ui/context-menu";
import { Trans, useLingui } from "@lingui/react/macro";
import { Check, Copy, Save, X } from "lucide-react";
import { useRef } from "react";
import type { SharedFileDocument } from "../../state/fileDocumentStore/types";

export function FileDocumentTabs({
	documents,
	selectedId,
	previewId,
	onSelect,
	onClose,
	onSaveAll,
	onError,
}: {
	documents: SharedFileDocument[];
	selectedId?: string;
	previewId: string | null;
	onSelect(id: string): void;
	onClose(ids: string[]): void;
	onSaveAll(): void;
	onError(message: string): void;
}) {
	const { t } = useLingui();
	const refs = useRef(new Map<string, HTMLButtonElement>());
	return (
		<div
			role="tablist"
			aria-label={t({ message: "Files" })}
			className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b"
		>
			{documents.map((document, index) => (
				<ContextMenu key={document.id}>
					<ContextMenuTrigger asChild>
						<div
							className={`flex shrink-0 items-center border-r px-2 text-xs ${document.id === selectedId ? "bg-fill-selected" : "text-muted-foreground"}`}
						>
							<button
								type="button"
								role="tab"
								tabIndex={document.id === selectedId ? 0 : -1}
								aria-selected={document.id === selectedId}
								title={document.absolutePath}
								ref={(element) => {
									if (element) refs.current.set(document.id, element);
									else refs.current.delete(document.id);
								}}
								className={`h-full px-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${document.id === previewId ? "italic" : ""}`}
								onClick={() => onSelect(document.id)}
								onKeyDown={(event) => {
									let next: number | undefined;
									if (event.key === "ArrowRight")
										next = (index + 1) % documents.length;
									if (event.key === "ArrowLeft")
										next = (index + documents.length - 1) % documents.length;
									if (event.key === "Home") next = 0;
									if (event.key === "End") next = documents.length - 1;
									if (next !== undefined) {
										event.preventDefault();
										onSelect(documents[next].id);
										refs.current.get(documents[next].id)?.focus();
									}
									if (event.key === "Delete" && !document.pendingSave) {
										event.preventDefault();
										onClose([document.id]);
									}
								}}
							>
								{document.absolutePath.split(/[\\/]/).pop()}
								{document.dirty ? " •" : ""}
							</button>
							<Button
								variant="ghost"
								size="icon"
								className="size-5"
								aria-label={t({ message: "Close file" })}
								title={t({ message: "Close file" })}
								disabled={document.pendingSave}
								onClick={() => onClose([document.id])}
							>
								<X className="size-3" />
							</Button>
						</div>
					</ContextMenuTrigger>
					<ContextMenuContent>
						<ContextMenuItem
							disabled={document.pendingSave}
							onSelect={() => onClose([document.id])}
						>
							<X />
							<Trans>Close</Trans>
							<ContextMenuShortcut>
								<Trans>Delete</Trans>
							</ContextMenuShortcut>
						</ContextMenuItem>
						<ContextMenuItem
							disabled={documents.length < 2}
							onSelect={() =>
								onClose(
									documents
										.filter((item) => item.id !== document.id)
										.map((item) => item.id),
								)
							}
						>
							<X />
							<Trans>Close Others</Trans>
						</ContextMenuItem>
						<ContextMenuItem
							disabled={index === documents.length - 1}
							onSelect={() =>
								onClose(documents.slice(index + 1).map((item) => item.id))
							}
						>
							<X />
							<Trans>Close to the Right</Trans>
						</ContextMenuItem>
						<ContextMenuItem
							disabled={
								!documents.some((item) => !item.dirty && !item.pendingSave)
							}
							onSelect={() =>
								onClose(
									documents
										.filter((item) => !item.dirty && !item.pendingSave)
										.map((item) => item.id),
								)
							}
						>
							<Check />
							<Trans>Close Saved</Trans>
						</ContextMenuItem>
						<ContextMenuItem
							onSelect={() => onClose(documents.map((item) => item.id))}
						>
							<X />
							<Trans>Close All</Trans>
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							disabled={
								!documents.some((item) => item.dirty && !item.pendingSave)
							}
							onSelect={onSaveAll}
						>
							<Save />
							<Trans>Save All</Trans>
						</ContextMenuItem>
						<ContextMenuItem
							onSelect={() => {
								void navigator.clipboard
									.writeText(document.absolutePath)
									.catch((cause) =>
										onError(
											cause instanceof Error ? cause.message : String(cause),
										),
									);
							}}
						>
							<Copy />
							<Trans>Copy Path</Trans>
						</ContextMenuItem>
					</ContextMenuContent>
				</ContextMenu>
			))}
		</div>
	);
}
