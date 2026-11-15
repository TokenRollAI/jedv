import type { ExternalApp } from "@jedv/local-db";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@jedv/ui/dropdown-menu";
import { toast } from "@jedv/ui/sonner";
import { Trans, useLingui } from "@lingui/react/macro";
import { SquareArrowOutUpRight } from "lucide-react";
import {
	getAppOption,
	OpenInExternalDropdownItems,
} from "renderer/components/OpenInExternalDropdown";
import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";
import { useHotkeyDisplay } from "renderer/hotkeys";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useResolvedTheme } from "renderer/stores/theme/store";

export function WorkspaceOpenInItems({
	path,
	onRun,
}: {
	path: string;
	onRun(action: () => void): void;
}) {
	const { t } = useLingui();
	const editor = electronTrpc.settings.getDefaultEditor.useQuery();
	const { copyToClipboard } = useCopyToClipboard();
	const theme = useResolvedTheme();
	const isDark = theme.type === "dark";
	const currentApp = editor.data ? getAppOption(editor.data) : null;
	const openShortcut = useHotkeyDisplay("OPEN_IN_APP").text;
	const copyShortcut = useHotkeyDisplay("COPY_PATH").text;
	const launch = (app?: ExternalApp) =>
		onRun(() => {
			void (
				app
					? electronTrpcClient.external.openInApp.mutate({ path, app })
					: electronTrpcClient.external.openFileInEditor.mutate({ path })
			).catch((error) =>
				toast.error(error instanceof Error ? error.message : String(error)),
			);
		});
	return (
		<>
			<DropdownMenuItem
				disabled={editor.isPending || editor.isError}
				onSelect={() => launch(editor.data ?? undefined)}
			>
				{currentApp ? (
					<img
						src={isDark ? currentApp.darkIcon : currentApp.lightIcon}
						alt=""
						className="size-4 object-contain"
					/>
				) : (
					<SquareArrowOutUpRight className="size-4" />
				)}
				{currentApp ? (
					t({
						message: `Open in ${currentApp.displayLabel ?? currentApp.label}`,
					})
				) : (
					<Trans>Open in external editor</Trans>
				)}
				{openShortcut !== "Unassigned" && (
					<DropdownMenuShortcut>{openShortcut}</DropdownMenuShortcut>
				)}
			</DropdownMenuItem>
			<DropdownMenuSub>
				<DropdownMenuSubTrigger>
					<SquareArrowOutUpRight className="size-4 text-muted-foreground" />
					<Trans>Open in</Trans>
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="min-w-48">
					<OpenInExternalDropdownItems
						isDark={isDark}
						activeApp={editor.data ?? undefined}
						onOpenIn={launch}
						onCopyPath={() =>
							onRun(() => {
								void copyToClipboard(path);
							})
						}
						copyPathTrailing={
							copyShortcut !== "Unassigned" ? (
								<DropdownMenuShortcut>{copyShortcut}</DropdownMenuShortcut>
							) : undefined
						}
						subContentClassName="w-40"
					/>
				</DropdownMenuSubContent>
			</DropdownMenuSub>
			{editor.error && (
				<p role="alert" className="px-2 py-1 text-xs text-destructive">
					{editor.error.message}
				</p>
			)}
			<DropdownMenuSeparator />
		</>
	);
}
