import { createContext, type ReactNode, useContext } from "react";
import type { JedvSurface } from "../../parity-types";
import { windowChromeGeometry } from "./geometry";

export const WindowChromeContext = createContext({
	...windowChromeGeometry(undefined, 1, false),
	surface: "terminal" as JedvSurface,
	collapsed: false,
	notification: null as ReactNode,
	onExpand: () => {},
});

export const useWindowChrome = () => useContext(WindowChromeContext);
