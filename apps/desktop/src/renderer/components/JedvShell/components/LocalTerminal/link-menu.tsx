import { i18n } from "@jedv/i18n";
import type { ExternalApp } from "@jedv/local-db";
import { msg } from "@lingui/core/macro";
import {
	ExternalLink,
	FileText,
	FolderOpen,
	PanelRight,
	SquarePlus,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	APP_OPTIONS,
	JETBRAINS_OPTIONS,
	VSCODE_OPTIONS,
} from "renderer/components/OpenInExternalDropdown/constants";
import type { LinkHoverInfo } from "renderer/lib/terminal/terminal-runtime-registry";
import { actionLabel } from "../JedvFilesView/utils/clickPolicy/actionLabel";
import { modifierLabel } from "../JedvFilesView/utils/clickPolicy/modifierLabel";
import { folderIntentLabel } from "../JedvFilesView/utils/clickPolicy/policies/folderPolicy";
import type {
	LinkSettings,
	LinkTier,
	ModifierEvent,
} from "../JedvFilesView/utils/link-policy/types";
import {
	canOpenTerminalLink,
	resolveTerminalLinkAction,
	type TerminalLinkAction,
	type TerminalLinkHandlers,
} from "./link-actions";

export const TERMINAL_LINK_TIERS: { tier: LinkTier; event: ModifierEvent }[] = [
	{ tier: "plain", event: { metaKey: false, ctrlKey: false, shiftKey: false } },
	{ tier: "shift", event: { metaKey: false, ctrlKey: false, shiftKey: true } },
	{ tier: "meta", event: { metaKey: true, ctrlKey: false, shiftKey: false } },
	{
		tier: "metaShift",
		event: { metaKey: true, ctrlKey: false, shiftKey: true },
	},
];

export interface TerminalLinkMenuItem {
	key: string;
	label: string;
	icon?: ReactNode;
	shortcut?: string;
	disabled?: boolean;
	onSelect?(): void;
	children?: TerminalLinkMenuItem[];
}

export function terminalLinkActionLabel(
	link: LinkHoverInfo,
	action: TerminalLinkAction,
) {
	if (
		action === "finder" ||
		action === "reveal" ||
		(action === "external" && link.kind === "file" && link.isDirectory)
	)
		return folderIntentLabel(action);
	return actionLabel(action, link.kind === "url" ? "url" : "file");
}

const ICONS: Record<TerminalLinkAction, ReactNode> = {
	pane: <FileText />,
	newTab: <SquarePlus />,
	rightPane: <PanelRight />,
	external: <ExternalLink />,
	reveal: <FolderOpen />,
	finder: <FolderOpen />,
};

export function createTerminalLinkMenu({
	link,
	settings,
	handlers,
	onAction,
	onOpenIn,
}: {
	link: LinkHoverInfo;
	settings: LinkSettings;
	handlers: Pick<TerminalLinkHandlers, "remote" | "onOpenFile" | "onOpenUrl">;
	onAction(action: TerminalLinkAction): void;
	onOpenIn(app: ExternalApp): void;
}): TerminalLinkMenuItem[] {
	const actions: TerminalLinkAction[] =
		link.kind === "url"
			? ["external"]
			: link.isDirectory
				? ["reveal", "external", "finder"]
				: ["pane", "newTab", "external", "finder"];
	const items = actions.map((action) => ({
		key: action,
		label: terminalLinkActionLabel(link, action),
		icon: ICONS[action],
		shortcut: TERMINAL_LINK_TIERS.filter(
			({ event }) =>
				resolveTerminalLinkAction(link, settings, event, handlers.remote) ===
				action,
		)
			.map(({ tier }) => modifierLabel(tier))
			.join(" / "),
		disabled: !canOpenTerminalLink(link, action, handlers),
		onSelect: () => onAction(action),
	}));
	if (link.kind === "url") return items;
	return [
		...items,
		{
			key: "applications",
			label: i18n._(msg({ message: "Open in" })),
			icon: <ExternalLink />,
			disabled: handlers.remote || !link.resolvedPath,
			children: [...APP_OPTIONS, ...VSCODE_OPTIONS, ...JETBRAINS_OPTIONS].map(
				(app) => ({
					key: app.id,
					label: app.displayLabel ?? app.label,
					icon: (
						<>
							<img
								src={app.lightIcon}
								alt=""
								className="size-4 object-contain dark:hidden"
							/>
							<img
								src={app.darkIcon}
								alt=""
								className="hidden size-4 object-contain dark:block"
							/>
						</>
					),
					disabled: handlers.remote || !link.resolvedPath,
					onSelect: () => onOpenIn(app.id),
				}),
			),
		},
	];
}
