export const WINDOW_CONTROLS_ROW_TOP = 7;
export const WINDOW_CONTROLS_ROW_HEIGHT = 32;
export const MAC_TRAFFIC_SAFE_WIDTH = 96;
export const WINDOW_CONTROLS_INSET_WIDTH =
	"calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))";

export function windowChromeGeometry(
	platform: string | undefined,
	zoomFactor: number,
	isFullScreen: boolean,
) {
	const isMac = platform === undefined || platform === "darwin";
	const counterScale = isMac && !isFullScreen;
	const scale = counterScale && zoomFactor > 0 ? zoomFactor : 1;
	return {
		isMac,
		counterScale,
		scale,
		leftInset: isFullScreen
			? "0px"
			: isMac
				? `${MAC_TRAFFIC_SAFE_WIDTH / scale}px`
				: "env(titlebar-area-x, 0px)",
		rightInset:
			isFullScreen || platform === "darwin"
				? "0px"
				: WINDOW_CONTROLS_INSET_WIDTH,
	};
}
