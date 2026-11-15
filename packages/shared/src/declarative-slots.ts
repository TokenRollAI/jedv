import { z } from "zod";

export const safeExternalUrlSchema = z
	.string()
	.max(2048)
	.url()
	.refine((raw) => {
		try {
			const u = new URL(raw);
			return (
				["https:", "mailto:"].includes(u.protocol) && !u.username && !u.password
			);
		} catch {
			return false;
		}
	}, "Only HTTPS or mailto links without credentials are allowed");
const field = z
	.object({
		label: z.string().min(1).max(40),
		text: z.string().max(240).optional(),
		payloadKey: z
			.string()
			.regex(/^[a-zA-Z0-9_-]{1,80}$/)
			.optional(),
	})
	.strict()
	.refine(
		(x) => (x.text !== undefined) !== (x.payloadKey !== undefined),
		"Choose text or a top-level payloadKey",
	);
export const slotManifestSchema = z
	.object({
		version: z.literal(1),
		id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
		name: z.string().min(1).max(80),
		slots: z
			.array(
				z.discriminatedUnion("target", [
					z
						.object({
							target: z.literal("teamwork.header"),
							items: z.array(field).min(1).max(4),
						})
						.strict(),
					z
						.object({
							target: z.literal("sidebar.panel"),
							cardType: z.enum(["summary", "kv_list"]),
							title: z.string().min(1).max(40),
							items: z.array(field).max(6),
							url: safeExternalUrlSchema.optional(),
						})
						.strict(),
					z
						.object({
							target: z.literal("mail.provider"),
							eventTypeSuffix: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
							allowedTo: z.string().min(1).max(128).default("leader"),
						})
						.strict(),
				]),
			)
			.min(1)
			.max(3),
	})
	.strict()
	.refine(
		(x) => new Set(x.slots.map((s) => s.target)).size === x.slots.length,
		"Only one declaration per target",
	);
export type SlotManifest = z.infer<typeof slotManifestSchema>;
export interface InstalledSlot {
	manifest: SlotManifest;
	enabled: boolean;
	teamId: string | null;
	installedAt: number;
}
export interface SlotView {
	extensionId: string;
	name: string;
	target: "teamwork.header" | "sidebar.panel";
	cardType?: "summary" | "kv_list";
	title?: string;
	items: Array<{ label: string; text: string }>;
	url?: string;
}
