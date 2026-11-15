import { expect, test } from "bun:test";
import {
	MAC_TRAFFIC_SAFE_WIDTH,
	WINDOW_CONTROLS_INSET_WIDTH,
	windowChromeGeometry,
} from "./geometry";

test("native controls stay clear under page zoom, fullscreen, and platform loading", () => {
	for (const zoom of [0.8, 1.25]) {
		const geometry = windowChromeGeometry("darwin", zoom, false);
		expect(Number.parseFloat(geometry.leftInset) * zoom).toBe(
			MAC_TRAFFIC_SAFE_WIDTH,
		);
		expect(geometry.counterScale).toBe(true);
	}
	const fullScreen = windowChromeGeometry("darwin", 0.8, true);
	expect(fullScreen.leftInset).toBe("0px");
	expect(fullScreen.rightInset).toBe("0px");
	expect(fullScreen.counterScale).toBe(false);
	const pending = windowChromeGeometry(undefined, 0.8, false);
	expect(Number.parseFloat(pending.leftInset) * 0.8).toBe(96);
	expect(pending.rightInset).toBe(WINDOW_CONTROLS_INSET_WIDTH);
	expect(windowChromeGeometry("win32", 1.25, false).rightInset).toBe(
		WINDOW_CONTROLS_INSET_WIDTH,
	);
	expect(windowChromeGeometry("linux", 1.25, false).scale).toBe(1);
});
