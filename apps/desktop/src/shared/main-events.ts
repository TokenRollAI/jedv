import { z } from "zod";

export const mainEventIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-zA-Z0-9_.:-]+$/);
export const mainSettingsSections = [
	"project",
	"workspace",
	"projects",
	"permissions",
	"appearance",
	"keyboard",
	"behavior",
	"git",
	"terminal",
	"integrations",
] as const;
export type MainSettingsSection = (typeof mainSettingsSections)[number];
export const hostOriginSchema = z
	.string()
	.max(2048)
	.refine((value) => {
		try {
			const url = new URL(value);
			return (
				["http:", "https:"].includes(url.protocol) &&
				!url.username &&
				!url.password &&
				url.pathname === "/" &&
				!url.search &&
				!url.hash
			);
		} catch {
			return false;
		}
	}, "Host must be an origin without credentials or query");
export const jedvNavigationSchema = z
	.object({
		hostUrl: hostOriginSchema.nullable(),
		workspaceId: mainEventIdSchema.nullable(),
		terminalId: mainEventIdSchema.nullable(),
		sidebarCollapsed: z.boolean(),
		collapsedProjects: z.array(mainEventIdSchema).max(64),
		collapsedGroups: z.array(z.string().min(1).max(4096)).max(128).default([]),
		workspaceSortMode: z.enum(["manual", "active", "created"]).optional(),
	})
	.strict();
export type JedvNavigationState = z.infer<typeof jedvNavigationSchema>;
export const mainVisibilitySchema = z
	.object({
		hostUrl: hostOriginSchema.nullable(),
		workspaceId: mainEventIdSchema.nullable(),
		visibleTerminalIds: z.array(mainEventIdSchema).max(32),
	})
	.strict();
export type MainWindowVisibility = z.infer<typeof mainVisibilitySchema>;
export type MainNavigationTarget =
	| {
			kind: "workspace";
			hostUrl: string;
			workspaceId: string;
			terminalId?: string;
	  }
	| { kind: "project"; hostUrl: string; projectId: string }
	| { kind: "settings"; section?: MainSettingsSection }
	| { kind: "automations" }
	| { kind: "pull-requests" }
	| {
			kind: "open-path";
			path: string;
			pathType: "file" | "directory";
			host: "local";
	  };
export interface MainLocalEvent {
	id: string;
	source: "deep-link" | "open-file" | "notification";
	target: MainNavigationTarget;
}

export const mainNavigationTargetSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("workspace"),
			hostUrl: hostOriginSchema,
			workspaceId: mainEventIdSchema,
			terminalId: mainEventIdSchema.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("project"),
			hostUrl: hostOriginSchema,
			projectId: mainEventIdSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("settings"),
			section: z.enum(mainSettingsSections).optional(),
		})
		.strict(),
	z.object({ kind: z.literal("automations") }).strict(),
	z.object({ kind: z.literal("pull-requests") }).strict(),
	z
		.object({
			kind: z.literal("open-path"),
			path: z.string().min(1).max(4096),
			pathType: z.enum(["file", "directory"]),
			host: z.literal("local"),
		})
		.strict(),
]);
