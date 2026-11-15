import { useZoomFactor } from "renderer/hooks/useZoomFactor";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { windowChromeGeometry } from "./geometry";

export function useWindowChromeMetrics() {
	const { data: platform } = electronTrpc.window.getPlatform.useQuery();
	const { data: isFullScreen = false } =
		electronTrpc.window.isFullScreen.useQuery(undefined, { retry: false });
	const utils = electronTrpc.useUtils();
	electronTrpc.window.onFullScreenChange.useSubscription(undefined, {
		onData: (value) => utils.window.isFullScreen.setData(undefined, value),
	});
	return windowChromeGeometry(platform, useZoomFactor(), isFullScreen);
}
