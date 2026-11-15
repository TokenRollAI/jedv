import {
	MAX_WORKSPACE_READ_RECEIPTS,
	readReceiptKey,
	receiptHostIdentity,
	type WorkspaceReadReceipt,
	type WorkspaceReadReceiptChange,
} from "shared/workspace-read-receipts";
import { create } from "zustand";

export { MAX_WORKSPACE_READ_RECEIPTS };
interface ReadReceipt {
	hostUrl: string;
	workspaceId: string;
	readThrough: number;
}
export interface ReadReceiptMutation {
	hostUrl: string;
	workspaceId: string;
	readThrough: number | null;
}
const keyFor = (hostUrl: string, workspaceId: string) =>
	readReceiptKey(receiptHostIdentity(hostUrl), workspaceId);
const pending = new Map<string, ReadReceiptMutation>();
const listeners = new Set<() => void>();
export const useWorkspaceReadReceipts = create<{
	receipts: ReadonlyMap<string, ReadReceipt>;
	syncError: Error | null;
}>(() => ({ receipts: new Map(), syncError: null }));
function put(receipts: Map<string, ReadReceipt>, change: ReadReceiptMutation) {
	const key = keyFor(change.hostUrl, change.workspaceId);
	receipts.delete(key);
	if (change.readThrough !== null)
		receipts.set(key, { ...change, readThrough: change.readThrough });
	while (receipts.size > MAX_WORKSPACE_READ_RECEIPTS) {
		const oldest = receipts.keys().next().value;
		if (oldest === undefined) break;
		receipts.delete(oldest);
	}
}
function mutate(change: ReadReceiptMutation) {
	const key = keyFor(change.hostUrl, change.workspaceId);
	pending.delete(key);
	pending.set(key, change);
	if (pending.size > MAX_WORKSPACE_READ_RECEIPTS) {
		const oldest = pending.keys().next().value;
		if (oldest !== undefined) pending.delete(oldest);
		useWorkspaceReadReceipts.setState({
			syncError: new Error(
				"Read receipt synchronization queue is full. Retry after connecting to the host.",
			),
		});
	}
	useWorkspaceReadReceipts.setState((state) => {
		const receipts = new Map(state.receipts);
		put(receipts, change);
		return { receipts };
	});
	for (const listener of listeners) listener();
}
export function markWorkspaceRead(
	hostUrl: string,
	workspaceId: string,
	readThrough?: number,
): void {
	if (
		!hostUrl ||
		!workspaceId ||
		readThrough == null ||
		!Number.isFinite(readThrough) ||
		readThrough <= 0
	)
		return;
	if (
		(useWorkspaceReadReceipts
			.getState()
			.receipts.get(keyFor(hostUrl, workspaceId))?.readThrough ?? 0) >=
		readThrough
	)
		return;
	mutate({ hostUrl, workspaceId, readThrough });
}
export function markWorkspaceUnread(
	hostUrl: string,
	workspaceId: string,
): void {
	if (hostUrl && workspaceId) mutate({ hostUrl, workspaceId, readThrough: -1 });
}
export function clearWorkspaceReadReceipt(
	hostUrl: string,
	workspaceId: string,
): void {
	if (hostUrl && workspaceId)
		mutate({ hostUrl, workspaceId, readThrough: null });
}
export function reconcileWorkspaceReadReceipts(
	hostUrl: string,
	workspaceIds: readonly string[],
): void {
	const live = new Set(workspaceIds);
	for (const receipt of useWorkspaceReadReceipts.getState().receipts.values())
		if (
			receiptHostIdentity(receipt.hostUrl) === receiptHostIdentity(hostUrl) &&
			!live.has(receipt.workspaceId)
		)
			clearWorkspaceReadReceipt(hostUrl, receipt.workspaceId);
}
export function workspaceReadThrough(
	receipts: ReadonlyMap<string, ReadReceipt>,
	hostUrl: string,
	workspaceId: string,
): number {
	return receipts.get(keyFor(hostUrl, workspaceId))?.readThrough ?? 0;
}
export const readReceiptSync = {
	pending: () => [...pending.values()],
	acknowledge(change: ReadReceiptMutation) {
		const key = keyFor(change.hostUrl, change.workspaceId);
		if (pending.get(key) === change) pending.delete(key);
	},
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
	merge(
		records: WorkspaceReadReceipt[],
		changes: WorkspaceReadReceiptChange[] = [],
	) {
		const receipts = new Map<string, ReadReceipt>();
		for (const record of records)
			put(receipts, { ...record, hostUrl: record.hostId });
		for (const change of changes) {
			if (change.evicted)
				receipts.delete(
					readReceiptKey(change.evicted.hostId, change.evicted.workspaceId),
				);
			put(receipts, { ...change, hostUrl: change.hostId });
		}
		for (const change of pending.values()) put(receipts, change);
		useWorkspaceReadReceipts.setState({ receipts });
	},
	apply(change: WorkspaceReadReceiptChange) {
		const receipts = new Map(useWorkspaceReadReceipts.getState().receipts);
		if (change.evicted)
			receipts.delete(
				readReceiptKey(change.evicted.hostId, change.evicted.workspaceId),
			);
		put(receipts, { ...change, hostUrl: change.hostId });
		for (const action of pending.values()) put(receipts, action);
		useWorkspaceReadReceipts.setState({ receipts });
	},
	setError(syncError: Error | null) {
		useWorkspaceReadReceipts.setState({ syncError });
	},
};
