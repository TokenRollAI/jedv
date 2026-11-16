export const MAIL_POLICY_KEY = "_jedvMail";
export const MAIL_PROCESSING_LEASE_MS = 10 * 60_000;

export interface MailReceipt {
	memberId: string;
	bindingKey: string;
	launchId: string | null;
	readAt: number;
	processingExpiresAt: number;
	ackedAt?: number;
}

export function mailReceipt(
	event: { payloadJson: string | null },
	deliveryId: string,
): MailReceipt | null {
	try {
		const receipt = JSON.parse(event.payloadJson ?? "{}")?.[MAIL_POLICY_KEY]
			?.receipts?.[deliveryId];
		return receipt &&
			typeof receipt.memberId === "string" &&
			typeof receipt.bindingKey === "string" &&
			typeof receipt.readAt === "number" &&
			typeof receipt.processingExpiresAt === "number"
			? (receipt as MailReceipt)
			: null;
	} catch {
		return null;
	}
}

export function mailConsumption(
	event: { payloadJson: string | null },
	delivery: { id: string; readAt: number | null; ackedAt: number | null },
	now: number,
) {
	const receipt =
		delivery.readAt === null ? null : mailReceipt(event, delivery.id);
	return {
		receipt,
		consumptionState:
			delivery.ackedAt !== null
				? receipt?.ackedAt !== undefined
					? ("acknowledged" as const)
					: ("legacy_acknowledged" as const)
				: receipt
					? !mailPolicy(event).requiresAck
						? ("read_no_ack" as const)
						: receipt.processingExpiresAt <= now
							? ("processing_overdue" as const)
							: ("processing" as const)
					: delivery.readAt !== null
						? ("legacy_read" as const)
						: ("unread" as const),
	};
}

export function mailPolicy(event: { payloadJson: string | null }) {
	try {
		const policy = event.payloadJson
			? JSON.parse(event.payloadJson)?.[MAIL_POLICY_KEY]
			: null;
		return {
			deliveryMode:
				policy?.deliveryMode === "interrupt"
					? ("interrupt" as const)
					: ("queue" as const),
			requiresAck: policy?.requiresAck !== false,
		};
	} catch {
		return { deliveryMode: "queue" as const, requiresAck: true };
	}
}
