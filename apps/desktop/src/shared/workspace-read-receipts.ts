import { z } from "zod";
export const MAX_WORKSPACE_READ_RECEIPTS = 256;
export const workspaceReadReceiptSchema = z
	.object({
		hostId: z.string().min(1).max(2048),
		workspaceId: z.string().min(1).max(256),
		readThrough: z
			.number()
			.finite()
			.refine((value) => value === -1 || value > 0),
	})
	.strict();
export type WorkspaceReadReceipt = z.infer<typeof workspaceReadReceiptSchema>;
export interface WorkspaceReadReceiptChange {
	hostId: string;
	workspaceId: string;
	readThrough: number | null;
	evicted?: { hostId: string; workspaceId: string };
}
export function readReceiptKey(hostId: string, workspaceId: string): string {
	return JSON.stringify([hostId, workspaceId]);
}
export function receiptHostIdentity(hostUrl: string): string {
	try {
		const url = new URL(hostUrl);
		return url.hostname === "127.0.0.1" && url.protocol === "http:"
			? "local"
			: url.origin;
	} catch {
		return hostUrl;
	}
}
export function parseReadReceipts(raw: unknown): WorkspaceReadReceipt[] {
	if (!Array.isArray(raw)) return [];
	const records = new Map<string, WorkspaceReadReceipt>();
	for (const value of raw.slice(-MAX_WORKSPACE_READ_RECEIPTS)) {
		const parsed = workspaceReadReceiptSchema.safeParse(value);
		if (parsed.success)
			records.set(
				readReceiptKey(parsed.data.hostId, parsed.data.workspaceId),
				parsed.data,
			);
	}
	return [...records.values()];
}
