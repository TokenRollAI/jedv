/**
 * Environment variables safe for SHARED CODE (main + renderer).
 *
 * This file only accesses individual process.env properties that are:
 * 1. Defined in Vite's `define` block (replaced at build time for renderer)
 * 2. Available in main process via actual process.env
 *
 * DO NOT spread ...process.env here - that only works in main process.
 *
 * For main-process-only env vars , use src/main/env.main.ts
 * For renderer-only env vars , use src/renderer/env.renderer.ts
 */
import { DEFAULT_DESKTOP_NOTIFICATIONS_PORT } from "@jedv/shared/desktop-notification";
import { z } from "zod/v4";

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	// Port env vars (set in root .env or written by setup.sh for inner worktrees)
	DESKTOP_VITE_PORT: z.coerce.number().default(5173),
	DESKTOP_NOTIFICATIONS_PORT: z.coerce
		.number()
		.int()
		.min(1)
		.max(65535)
		.default(DEFAULT_DESKTOP_NOTIFICATIONS_PORT),
	// Workspace name for instance isolation
	JEDV_WORKSPACE_NAME: z.string().default("jedv"),
});

/**
 * Shared environment variables.
 *
 * These work in both main and renderer because Vite's `define` replaces
 * process.env.NODE_ENV at build time for renderer, while main process
 * reads the actual value at runtime.
 */
export const env = envSchema.parse({
	NODE_ENV: process.env.NODE_ENV,
	DESKTOP_VITE_PORT: process.env.DESKTOP_VITE_PORT,
	DESKTOP_NOTIFICATIONS_PORT: process.env.DESKTOP_NOTIFICATIONS_PORT,
	JEDV_WORKSPACE_NAME: process.env.JEDV_WORKSPACE_NAME,
});

export function getWorkspaceName(): string | undefined {
	const name = env.JEDV_WORKSPACE_NAME;
	if (name === "jedv") return undefined;
	return name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.slice(0, 32);
}
