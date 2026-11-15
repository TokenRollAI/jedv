import { errorMessage } from "@jedv/i18n/errors";
import { toast } from "@jedv/ui/sonner";
import { useLingui } from "@lingui/react/macro";
import { LuMenu, LuPanelLeftOpen } from "react-icons/lu";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useWindowChrome } from "../../context";
import { WindowChromeControls } from "../WindowChromeControls";

export function WindowChromeLeading({
	leftmost,
	expand,
}: {
	leftmost?: boolean;
	expand?: boolean;
}) {
	const chrome = useWindowChrome();
	const { t } = useLingui();
	const isLeftmost = leftmost ?? chrome.collapsed;
	const showExpand = expand ?? chrome.collapsed;
	return (
		<>
			{isLeftmost && (
				<div
					data-native-left-inset
					className="drag h-full shrink-0"
					style={{ width: chrome.leftInset }}
				/>
			)}
			{isLeftmost && !chrome.isMac && (
				<WindowChromeControls className="shrink-0 px-1">
					<button
						type="button"
						aria-label={t({ message: "Application menu" })}
						className="no-drag grid size-7 place-items-center rounded text-muted-foreground hover:bg-fill-hover"
						onClick={() =>
							void electronTrpcClient.window.popupApplicationMenu
								.mutate()
								.catch((error) => toast.error(errorMessage(error)))
						}
					>
						<LuMenu className="size-4" />
					</button>
				</WindowChromeControls>
			)}
			{showExpand && (
				<WindowChromeControls className="shrink-0 px-2">
					<button
						type="button"
						aria-label={t({ message: "Toggle Sidebar" })}
						className="no-drag grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-fill-hover focus-visible:ring-1 focus-visible:ring-ring"
						onClick={chrome.onExpand}
					>
						<LuPanelLeftOpen className="size-4" />
					</button>
				</WindowChromeControls>
			)}
		</>
	);
}
