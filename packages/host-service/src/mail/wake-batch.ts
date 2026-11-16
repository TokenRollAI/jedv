import { MAIL_POLICY_KEY, mailPolicy } from "./policy";

type Event = { payloadJson: string | null };
type Delivery = {
	id: string;
	wakeBatchId: string | null;
	nudgedAt: number | null;
	nudgeState: string;
	inflightToken: string | null;
};
type Notification = { notifiedAt: number; bindingKey: string | null };
type Provenance = { version: 1; batches: Record<string, Notification> };

function legacyNotification(delivery: Delivery): Notification | null {
	return delivery.wakeBatchId &&
		delivery.nudgedAt !== null &&
		delivery.inflightToken === null &&
		["nudged", "skipped"].includes(delivery.nudgeState)
		? { notifiedAt: delivery.nudgedAt, bindingKey: null }
		: null;
}

function provenance(event: Event, delivery: Delivery): Provenance {
	const existing = JSON.parse(event.payloadJson ?? "{}")?.[MAIL_POLICY_KEY]
		?.wakeBatches?.[delivery.id];
	if (existing?.version === 1)
		return {
			version: 1,
			batches:
				existing.batches &&
				typeof existing.batches === "object" &&
				!Array.isArray(existing.batches)
					? existing.batches
					: {},
		};
	const legacy = legacyNotification(delivery);
	return {
		version: 1,
		batches:
			legacy && delivery.wakeBatchId ? { [delivery.wakeBatchId]: legacy } : {},
	};
}

/** Freeze legacy evidence before replacing the delivery's current attempt/batch. */
export function prepareWakeBatch(event: Event, delivery: Delivery): string {
	const payload = JSON.parse(event.payloadJson ?? "{}");
	const policy = payload[MAIL_POLICY_KEY] ?? mailPolicy(event);
	payload[MAIL_POLICY_KEY] = {
		...policy,
		wakeBatches: {
			...policy.wakeBatches,
			[delivery.id]: provenance(event, delivery),
		},
	};
	return JSON.stringify(payload);
}

export function recordWakeBatch(
	event: Event,
	delivery: Delivery,
	batchId: string,
	bindingKey: string,
	notifiedAt: number,
): string {
	const payload = JSON.parse(prepareWakeBatch(event, delivery));
	payload[MAIL_POLICY_KEY].wakeBatches[delivery.id].batches[batchId] = {
		bindingKey,
		notifiedAt,
	};
	return JSON.stringify(payload);
}

export function hasDeliveredWakeBatch(
	event: Event,
	delivery: Delivery,
	batchId: string,
): boolean {
	const notification = provenance(event, delivery).batches?.[batchId];
	return !!notification && Number.isFinite(notification.notifiedAt);
}
