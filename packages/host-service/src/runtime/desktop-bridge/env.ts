import type { DesktopBridgeConfig } from "../../types";

/**
 * Build the desktop-bridge config from env, or undefined when either var is
 * absent (standalone hosts with no desktop app). Shared by every host entry
 * point so the URL+secret pairing is validated in one place.
 */
export function resolveDesktopBridgeFromEnv(env: {
	DESKTOP_BRIDGE_URL?: string;
	DESKTOP_BRIDGE_SECRET?: string;
}): DesktopBridgeConfig | undefined {
	if (!env.DESKTOP_BRIDGE_URL || !env.DESKTOP_BRIDGE_SECRET) return undefined;
	return { url: env.DESKTOP_BRIDGE_URL, secret: env.DESKTOP_BRIDGE_SECRET };
}
