import {
	type ButlerApprovalShape,
	butlerApprovalListSchema,
	guardedActionSchema,
} from "@jedv/shared/butler";
import type { z } from "zod";
import type { MemorySqlite } from "../memory/sqlite";

// Expiry is derived at read time here: model tools never mutate approval state.
export function readApprovalCards(
	db: MemorySqlite,
	raw: z.input<typeof butlerApprovalListSchema> = {},
	now = Date.now(),
): ButlerApprovalShape[] {
	const x = butlerApprovalListSchema.parse(raw);
	const effective =
		"CASE WHEN status='pending' AND expires_at<=? THEN 'expired' ELSE status END";
	const rows = db
		.prepare(
			`SELECT id,thread_id AS threadId,action_type AS actionType,target_id AS targetId,summary,canonical_payload_json AS payloadJson,payload_hash AS payloadHash,${effective} AS status,created_at AS createdAt,expires_at AS expiresAt,resolved_at AS resolvedAt,error FROM butler_approvals WHERE 1=1${x.status === "pending" ? " AND status='pending' AND expires_at>?" : x.status === "history" ? " AND (status<>'pending' OR expires_at<=?)" : ""}${x.threadId ? " AND thread_id=?" : ""}${x.approvalId ? " AND id=?" : ""} ORDER BY created_at DESC,rowid DESC LIMIT ?`,
		)
		.all(
			now,
			...(x.status !== "all" ? [now] : []),
			...(x.threadId ? [x.threadId] : []),
			...(x.approvalId ? [x.approvalId] : []),
			x.limit,
		) as Array<Omit<ButlerApprovalShape, "payload"> & { payloadJson: string }>;
	return rows.map(({ payloadJson, ...row }) => ({
		...row,
		payload: guardedActionSchema.parse(JSON.parse(payloadJson)),
	}));
}
