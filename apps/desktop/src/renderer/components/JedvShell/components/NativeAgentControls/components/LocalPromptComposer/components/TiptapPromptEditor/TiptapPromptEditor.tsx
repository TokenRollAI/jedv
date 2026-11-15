import {
	usePromptInputAttachments,
	usePromptInputController,
} from "@jedv/ui/ai-elements/prompt-input";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@jedv/ui/command";
import { getClipboardFiles } from "@jedv/ui/lib/clipboard-files";
import { Popover, PopoverAnchor, PopoverContent } from "@jedv/ui/popover";
import { cn } from "@jedv/ui/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { type Editor, Extension } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Paragraph } from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import { Text } from "@tiptap/extension-text";
import { PluginKey } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";

const slashSuggestionKey = new PluginKey("slashCommandSuggestion");
const mentionSuggestionKey = new PluginKey("fileMentionSuggestion");

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useDebouncedValue } from "renderer/hooks/useDebouncedValue";
import { resolveHotkeyFromEvent } from "renderer/hotkeys";
import { FileIcon } from "renderer/lib/fileIcons";
import { SlashCommandMenu } from "./components/SlashCommandMenu";
import { FileMentionNode } from "./FileMentionNode";
import { parseTextToEditorContent } from "./parseTextToEditorContent";
import { SlashCommandNode } from "./SlashCommandNode";
import {
	type PreviewSlashCommandFn,
	SlashCommandPreviewPopover,
} from "./SlashCommandPreviewPopover";
import { serializeEditorToText } from "./serializeEditorToText";
import {
	getCommandMatchRank,
	type ModelOption,
	type SlashCommand,
	shouldSuppressSlashMenuForCommittedCommand,
	sortSlashCommandMatches,
} from "./slash-commands";

type FileResult = { id: string; name: string; relativePath: string };
type SearchFilesFn = (query: string) => Promise<FileResult[]>;

type SlashMenuState = {
	commands: SlashCommand[];
	selectedIndex: number;
	tiptapCommand: (props: { cmd: SlashCommand }) => void;
};

type MentionSelection = { kind: "file"; path: string };

type MentionState = {
	query: string;
	selectedIndex: number;
	tiptapCommand: (props: MentionSelection) => void;
	clientRect: (() => DOMRect | null) | null;
};

export interface TiptapPromptEditorProps {
	cwd: string;
	searchFiles: SearchFilesFn;
	disabled?: boolean;
	previewSlashCommand?: PreviewSlashCommandFn;
	slashCommands: SlashCommand[];
	availableModels?: ModelOption[];
	placeholder?: string;
	className?: string;
	focusShortcutText?: string;
}

function getDirectoryPath(relativePath: string): string {
	const lastSlash = relativePath.lastIndexOf("/");
	if (lastSlash === -1) return "";
	return relativePath.slice(0, lastSlash);
}

export function TiptapPromptEditor({
	cwd,
	searchFiles,
	disabled = false,
	previewSlashCommand,
	slashCommands,
	availableModels,
	placeholder,
	className,
	focusShortcutText,
}: TiptapPromptEditorProps) {
	const { t } = useLingui();
	const resolvedPlaceholder =
		placeholder ??
		t({
			message: "Ask to make changes, @mention files, run /commands",
		});
	const controller = usePromptInputController();
	const attachments = usePromptInputAttachments();
	const slashCommandsRef = useRef(slashCommands);
	slashCommandsRef.current = slashCommands;
	const availableModelsRef = useRef(availableModels);
	availableModelsRef.current = availableModels;

	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;
	const controllerRef = useRef(controller);
	controllerRef.current = controller;
	const lastEditorSyncedValue = useRef("");
	const isComposingRef = useRef(false);
	const [isFocused, setIsFocused] = useState(false);
	const [chipHovered, setChipHovered] = useState(false);
	const [_chipArgFocused, setChipArgFocused] = useState(false);
	const [chipNodeSelected, setChipNodeSelected] = useState(false);
	const [slashMenu, setSlashMenu] = useState<SlashMenuState | null>(null);
	const slashMenuRef = useRef(slashMenu);
	slashMenuRef.current = slashMenu;
	const isSlashOpenRef = useRef(false);
	const [mentionState, setMentionState] = useState<MentionState | null>(null);
	const mentionStateRef = useRef(mentionState);
	mentionStateRef.current = mentionState;
	const mentionAnchorRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const el = mentionAnchorRef.current;
		if (!el || !mentionState?.clientRect) return;
		const rect = mentionState.clientRect();
		if (!rect) return;
		el.style.left = `${rect.left}px`;
		el.style.top = `${rect.top}px`;
		el.style.width = `${rect.width}px`;
		el.style.height = `${rect.height}px`;
	}, [mentionState]);

	const debouncedMentionQuery = useDebouncedValue(
		mentionState?.query ?? "",
		120,
	);
	const isMentionVisible =
		mentionState !== null && (mentionState?.query?.length ?? 0) > 0;
	const [fileResults, setFileResults] = useState<FileResult[]>([]);
	const [fileError, setFileError] = useState<string | null>(null);
	const [fileLoading, setFileLoading] = useState(false);
	useEffect(() => {
		if (!isMentionVisible || !cwd || debouncedMentionQuery.length === 0) return;
		let cancelled = false;
		setFileLoading(true);
		setFileError(null);
		searchFiles(debouncedMentionQuery)
			.then((results) => {
				if (!cancelled) setFileResults(results);
			})
			.catch((cause) => {
				if (!cancelled) {
					setFileResults([]);
					setFileError(cause instanceof Error ? cause.message : String(cause));
				}
			})
			.finally(() => {
				if (!cancelled) setFileLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [debouncedMentionQuery, cwd, isMentionVisible, searchFiles]);

	const mentionFiles: FileResult[] = isMentionVisible ? fileResults : [];
	const mentionEntries: MentionSelection[] = mentionFiles.map((file) => ({
		kind: "file",
		path: file.relativePath,
	}));
	const mentionEntriesRef = useRef(mentionEntries);
	mentionEntriesRef.current = mentionEntries;
	useEffect(() => {
		if (!mentionState || mentionEntries.length === 0) return;
		const max = mentionEntries.length - 1;
		if (mentionState.selectedIndex > max) {
			setMentionState((prev) =>
				prev ? { ...prev, selectedIndex: max } : null,
			);
		}
	}, [mentionEntries.length, mentionState]);
	const editor = useEditor({
		immediatelyRender: false,
		editable: !disabled,

		onFocus: () => setIsFocused(true),
		onBlur: () => setIsFocused(false),

		extensions: [
			Document,
			Text,
			Paragraph,
			HardBreak,
			History,

			Placeholder.configure({ placeholder: resolvedPlaceholder }),

			FileMentionNode,
			SlashCommandNode,
			Extension.create({
				name: "chatInputKeyboard",
				addKeyboardShortcuts() {
					return {
						Enter: () => {
							if (isComposingRef.current) return false;
							if (isSlashOpenRef.current) return false;
							if (mentionStateRef.current !== null) return false;
							const dom = this.editor.view.dom;
							const form = dom.closest("form");
							if (!form) return false;
							const submitBtn = form.querySelector<HTMLButtonElement>(
								'button[type="submit"]',
							);
							if (submitBtn?.disabled) return true;
							form.requestSubmit();
							return true;
						},

						"Shift-Enter": () => {
							return this.editor.commands.setHardBreak();
						},

						Backspace: () => {
							const { state } = this.editor;
							const para = state.doc.firstChild;
							const docIsEmpty =
								state.doc.childCount === 1 &&
								para !== null &&
								para.childCount === 0;
							if (!docIsEmpty) return false;
							const last = attachmentsRef.current.files.at(-1);
							if (last) {
								attachmentsRef.current.remove(last.id);
								return true;
							}
							return false;
						},
					};
				},
			}),
			Extension.create({
				name: "slashCommand",
				addProseMirrorPlugins() {
					return [
						Suggestion({
							pluginKey: slashSuggestionKey,
							editor: this.editor,
							char: "/",
							allowSpaces: false,
							allow: ({ state, range }) => {
								const $pos = state.doc.resolve(range.from);
								if ($pos.parentOffset === 0) return true;
								const textBefore = $pos.parent.textBetween(
									0,
									$pos.parentOffset,
									"\0",
									" ",
								);
								const charBefore = textBefore.slice(-1);
								return charBefore === " " || charBefore === "\n";
							},

							items: ({ query }: { query: string }) => {
								const commands = slashCommandsRef.current;
								const q = query.toLowerCase();
								if (shouldSuppressSlashMenuForCommittedCommand(q, commands)) {
									return [];
								}
								const matches = commands
									.map((command) => {
										const rank = getCommandMatchRank(command, q);
										return rank === null ? null : { command, rank };
									})
									.filter(
										(item): item is { command: SlashCommand; rank: number } =>
											item !== null,
									);
								return sortSlashCommandMatches(matches);
							},

							render: () => ({
								onStart(props: {
									items: SlashCommand[];
									command: (p: { cmd: SlashCommand }) => void;
								}) {
									setSlashMenu({
										commands: props.items,
										selectedIndex: 0,
										tiptapCommand: props.command,
									});
								},
								onUpdate(props: {
									items: SlashCommand[];
									command: (p: { cmd: SlashCommand }) => void;
								}) {
									setSlashMenu((prev) =>
										prev
											? {
													...prev,
													commands: props.items,
													tiptapCommand: props.command,
													selectedIndex: Math.min(
														prev.selectedIndex,
														Math.max(0, props.items.length - 1),
													),
												}
											: null,
									);
								},
								onKeyDown({ event }: { event: KeyboardEvent }) {
									const menu = slashMenuRef.current;
									if (!menu || menu.commands.length === 0) return false;

									if (event.key === "Escape") {
										setSlashMenu(null);
										return true;
									}
									if (event.key === "ArrowUp") {
										setSlashMenu((prev) =>
											prev
												? {
														...prev,
														selectedIndex:
															prev.selectedIndex <= 0
																? prev.commands.length - 1
																: prev.selectedIndex - 1,
													}
												: null,
										);
										return true;
									}
									if (event.key === "ArrowDown") {
										setSlashMenu((prev) =>
											prev
												? {
														...prev,
														selectedIndex:
															prev.selectedIndex >= prev.commands.length - 1
																? 0
																: prev.selectedIndex + 1,
													}
												: null,
										);
										return true;
									}
									if (event.key === "Enter") {
										const cmd = menu.commands[menu.selectedIndex];
										if (cmd) menu.tiptapCommand({ cmd });
										return true;
									}
									return false;
								},
								onExit() {
									setSlashMenu(null);
								},
							}),

							command({
								editor: ed,
								range,
								props,
							}: {
								editor: Editor;
								range: { from: number; to: number };
								props: { cmd: SlashCommand };
							}) {
								const cmd = props.cmd;
								const argumentOptions =
									cmd.action?.type === "set_model"
										? (availableModelsRef.current?.map((m) => m.name) ?? [])
										: [];
								ed.chain()
									.deleteRange(range)
									.insertContentAt(range.from, {
										type: "slash-command",
										attrs: {
											name: cmd.name,
											argumentHint: cmd.argumentHint,
											argumentOptions,
										},
									})
									.run();
							},
						}),
					];
				},
			}),
			Extension.create({
				name: "fileMention",
				addProseMirrorPlugins() {
					return [
						Suggestion({
							pluginKey: mentionSuggestionKey,
							editor: this.editor,
							char: "@",
							allowSpaces: false,
							allow: ({ state, range }) => {
								const $pos = state.doc.resolve(range.from);
								if ($pos.parentOffset === 0) return true;
								const textBefore = $pos.parent.textBetween(
									0,
									$pos.parentOffset,
									"\0",
									" ",
								);
								const charBefore = textBefore.slice(-1);
								return charBefore === " " || charBefore === "\n";
							},
							items: () => [] as FileResult[],

							render: () => ({
								onStart(props: {
									query: string;
									command: (p: MentionSelection) => void;
									clientRect?: (() => DOMRect | null) | null;
								}) {
									setMentionState({
										query: props.query,
										selectedIndex: 0,
										tiptapCommand: props.command,
										clientRect: props.clientRect ?? null,
									});
								},
								onUpdate(props: {
									query: string;
									command: (p: MentionSelection) => void;
									clientRect?: (() => DOMRect | null) | null;
								}) {
									setMentionState((prev) =>
										prev
											? {
													...prev,
													query: props.query,
													selectedIndex: 0,
													tiptapCommand: props.command,
													clientRect: props.clientRect ?? null,
												}
											: null,
									);
								},
								onKeyDown({ event }: { event: KeyboardEvent }) {
									const mention = mentionStateRef.current;
									const entries = mentionEntriesRef.current;
									if (!mention) return false;
									if (event.isComposing || isComposingRef.current) return false;

									if (event.key === "Escape") {
										setMentionState(null);
										return true;
									}
									if (event.key === "ArrowUp") {
										setMentionState((prev) =>
											prev
												? {
														...prev,
														selectedIndex:
															prev.selectedIndex <= 0
																? Math.max(0, entries.length - 1)
																: prev.selectedIndex - 1,
													}
												: null,
										);
										return true;
									}
									if (event.key === "ArrowDown") {
										setMentionState((prev) =>
											prev
												? {
														...prev,
														selectedIndex:
															entries.length === 0
																? 0
																: prev.selectedIndex >= entries.length - 1
																	? 0
																	: prev.selectedIndex + 1,
													}
												: null,
										);
										return true;
									}
									if (
										(event.key === "Enter" && !event.shiftKey) ||
										event.key === "Tab"
									) {
										const entry = entries[mention.selectedIndex];
										if (entry) {
											mention.tiptapCommand(entry);
											return true;
										}
										setMentionState(null);
										return true;
									}
									return false;
								},
								onExit() {
									setMentionState(null);
								},
							}),

							command({
								editor: ed,
								range,
								props,
							}: {
								editor: Editor;
								range: { from: number; to: number };
								props: MentionSelection;
							}) {
								const mentionNode = {
									type: "file-mention",
									attrs: { path: props.path },
								};
								ed.chain()
									.deleteRange(range)
									.insertContentAt(range.from, [
										mentionNode,
										{ type: "text", text: " " },
									])
									.run();
							},
						}),
					];
				},
			}),
		],

		editorProps: {
			attributes: {
				"data-slot": "input-group-control",
				class: "tiptap-chat-input focus-visible:outline-none",
			},

			handleDOMEvents: {
				compositionstart: () => {
					isComposingRef.current = true;
					return false;
				},
				compositionend: () => {
					isComposingRef.current = false;
					return false;
				},
				keydown: (_view, event) => {
					if (
						(event.key === "ArrowLeft" || event.key === "ArrowRight") &&
						(event.metaKey || event.ctrlKey) &&
						(!event.altKey || resolveHotkeyFromEvent(event) === null)
					) {
						event.stopPropagation();
					}
					return false;
				},
			},

			handlePaste: (_view, event) => {
				const files = getClipboardFiles(event.clipboardData);
				if (files.length === 0) return false;
				attachmentsRef.current.add(files);
				if (event.clipboardData?.getData("text/plain")) return false;
				event.preventDefault();
				return true;
			},
		},

		onUpdate: ({ editor: e }) => {
			const text = serializeEditorToText(e);
			lastEditorSyncedValue.current = text;
			controllerRef.current.textInput.setInput(text);
		},
	});
	useEffect(() => {
		if (!editor) return;
		controller.__registerFocusCallback(() => {
			editor.commands.focus("end");
		});
		return () => {
			controller.__registerFocusCallback(null);
		};
	}, [controller, editor]);
	useEffect(() => {
		if (!editor) return;
		const update = () => {
			const { selection } = editor.state;
			const node = (selection as { node?: { type: { name: string } } }).node;
			setChipNodeSelected(node?.type?.name === "slash-command");
		};
		editor.on("selectionUpdate", update);
		return () => {
			editor.off("selectionUpdate", update);
		};
	}, [editor]);
	useEffect(() => {
		if (!editor) return;
		const externalText = controller.textInput.value;
		if (externalText === lastEditorSyncedValue.current) return;
		const currentText = serializeEditorToText(editor);
		if (externalText === currentText) return;
		editor.commands.setContent(
			externalText
				? parseTextToEditorContent(externalText)
				: { type: "doc", content: [{ type: "paragraph" }] },
			{ emitUpdate: false },
		);
		lastEditorSyncedValue.current = externalText;
	}, [controller.textInput.value, editor]);

	useEffect(() => {
		editor?.setEditable(!disabled);
	}, [editor, disabled]);
	const isSlashOpen = slashMenu !== null && slashMenu.commands.length > 0;
	isSlashOpenRef.current = isSlashOpen;
	const isMentionOpen = mentionState !== null;

	return (
		<>
			{}
			{editor && previewSlashCommand && (
				<SlashCommandPreviewPopover
					cwd={cwd}
					previewSlashCommand={previewSlashCommand}
					slashCommands={slashCommands}
					editor={editor}
					isFocused={chipHovered || chipNodeSelected}
				/>
			)}

			{}
			<Popover open={isSlashOpen && isFocused}>
				<PopoverAnchor asChild>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: event delegation pattern for chip hover/focus detection */}
					<div
						role="presentation"
						className={cn(
							"relative w-full overflow-y-auto px-3 py-3 text-sm",
							"min-h-10 max-h-48",
							focusShortcutText && !isFocused && "pr-20",
							className,
						)}
						onMouseOver={(e) => {
							if (
								(e.target as Element).closest(
									"[data-node-type='slash-command']",
								)
							) {
								setChipHovered(true);
							}
						}}
						onMouseOut={(e) => {
							if (
								!(e.relatedTarget as Element | null)?.closest(
									"[data-node-type='slash-command']",
								)
							) {
								setChipHovered(false);
							}
						}}
						onFocus={(e) => {
							if (
								(e.target as Element).closest(
									"[data-node-type='slash-command']",
								)
							) {
								setChipArgFocused(true);
							}
						}}
						onBlur={(e) => {
							if (
								!(e.relatedTarget as Element | null)?.closest(
									"[data-node-type='slash-command']",
								)
							) {
								setChipArgFocused(false);
							}
						}}
					>
						{focusShortcutText && !isFocused && (
							<span className="pointer-events-none absolute top-0 right-3 flex h-full items-center text-xs text-muted-foreground/50">
								<Trans>{focusShortcutText} to focus</Trans>
							</span>
						)}
						<EditorContent editor={editor} />
					</div>
				</PopoverAnchor>
				{isSlashOpen && slashMenu && (
					<SlashCommandMenu
						commands={slashMenu.commands}
						selectedIndex={slashMenu.selectedIndex}
						onSelect={(cmd) => slashMenu.tiptapCommand({ cmd })}
						onHover={(i) =>
							setSlashMenu((prev) =>
								prev ? { ...prev, selectedIndex: i } : null,
							)
						}
					/>
				)}
			</Popover>

			{}
			<Popover open={isMentionOpen && isFocused}>
				<PopoverAnchor asChild>
					<div
						ref={mentionAnchorRef}
						className="pointer-events-none fixed"
						aria-hidden="true"
					/>
				</PopoverAnchor>
				{isMentionOpen && (
					<PopoverContent
						side="top"
						align="start"
						sideOffset={4}
						className="w-80 p-0 text-xs"
						onOpenAutoFocus={(e) => e.preventDefault()}
						onCloseAutoFocus={(e) => e.preventDefault()}
						onMouseDown={(e) => e.preventDefault()}
					>
						<Command shouldFilter={false}>
							<CommandInput
								placeholder={t({ message: "Search files..." })}
								value={mentionState?.query ?? ""}
								onValueChange={(q) =>
									setMentionState((prev) =>
										prev ? { ...prev, query: q } : null,
									)
								}
							/>
							<CommandList className="max-h-[200px] [&::-webkit-scrollbar]:hidden">
								{mentionEntries.length === 0 && (
									<CommandEmpty className="px-2 py-3 text-left text-xs text-muted-foreground">
										{!mentionState?.query ? (
											<Trans>Type to search files...</Trans>
										) : fileLoading ? (
											<Trans>Searching…</Trans>
										) : fileError ? (
											<span role="alert">{fileError}</span>
										) : (
											<Trans>No results found.</Trans>
										)}
									</CommandEmpty>
								)}
								{mentionFiles.length > 0 && (
									<CommandGroup
										heading={t({
											message: "Files",
										})}
									>
										{mentionFiles.map((file, idx) => {
											const dirPath = getDirectoryPath(file.relativePath);
											const entryIndex = idx;
											return (
												<CommandItem
													key={file.id}
													value={file.relativePath}
													className={cn(
														entryIndex ===
															(mentionState?.selectedIndex ?? -1) &&
															"bg-accent",
													)}
													onSelect={() => {
														mentionState?.tiptapCommand({
															kind: "file",
															path: file.relativePath,
														});
													}}
												>
													<FileIcon
														fileName={file.name}
														className="size-3.5 shrink-0"
													/>
													<span className="truncate text-xs">{file.name}</span>
													{dirPath && (
														<span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
															{dirPath}
														</span>
													)}
												</CommandItem>
											);
										})}
									</CommandGroup>
								)}
							</CommandList>
						</Command>
					</PopoverContent>
				)}
			</Popover>
		</>
	);
}
