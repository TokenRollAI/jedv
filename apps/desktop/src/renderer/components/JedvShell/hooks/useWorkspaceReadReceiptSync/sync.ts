import {
	MAX_WORKSPACE_READ_RECEIPTS,
	readReceiptKey,
	type WorkspaceReadReceipt,
	type WorkspaceReadReceiptChange,
} from "shared/workspace-read-receipts";
import {
	type ReadReceiptMutation,
	readReceiptSync,
} from "../../components/JedvWorkspacesBoard/stores/read-receipts";
export interface ReadReceiptClient {
	get(): Promise<WorkspaceReadReceipt[]>;
	set(change: ReadReceiptMutation): Promise<WorkspaceReadReceiptChange>;
	subscribe(
		onChange: (change: WorkspaceReadReceiptChange) => void,
		onReconnect: () => void,
		onError: (error: unknown) => void,
	): () => void;
}
export function createReadReceiptSync(
	client: ReadReceiptClient,
	onReady: (ready: boolean) => void,
) {
	let disposed = false;
	let ready = false;
	let loading: Promise<void> | null = null;
	let writing: Promise<void> | null = null;
	const buffered = new Map<string, WorkspaceReadReceiptChange>();
	let overflow = false;
	const fail = (error: unknown) =>
		readReceiptSync.setError(
			error instanceof Error ? error : new Error(String(error)),
		);
	async function drain() {
		if (disposed || !ready || writing) return writing;
		writing = (async () => {
			while (!disposed) {
				const change = readReceiptSync.pending()[0];
				if (!change) break;
				try {
					const result = await client.set(change);
					readReceiptSync.acknowledge(change);
					readReceiptSync.apply(result);
					readReceiptSync.setError(null);
				} catch (error) {
					fail(error);
					return;
				}
			}
		})().finally(() => {
			writing = null;
		});
		return writing;
	}
	async function refresh() {
		if (disposed) return;
		if (loading) return loading;
		buffered.clear();
		overflow = false;
		loading = (async () => {
			try {
				const records = await client.get();
				if (disposed) return;
				if (overflow)
					throw new Error(
						"Read receipt synchronization queue is full. Retry after connecting to the host.",
					);
				readReceiptSync.merge(records, [...buffered.values()]);
				ready = true;
				onReady(true);
				readReceiptSync.setError(null);
				await drain();
			} catch (error) {
				if (!disposed) fail(error);
			}
		})().finally(() => {
			loading = null;
			buffered.clear();
		});
		return loading;
	}
	const stopChanges = client.subscribe(
		(change) => {
			if (disposed) return;
			if (loading) {
				const key = readReceiptKey(change.hostId, change.workspaceId);
				if (buffered.has(key) || buffered.size < MAX_WORKSPACE_READ_RECEIPTS)
					buffered.set(key, change);
				else overflow = true;
			}
			readReceiptSync.apply(change);
		},
		() => {
			void refresh();
		},
		fail,
	);
	const stopActions = readReceiptSync.subscribe(() => {
		void drain();
	});
	return {
		start: refresh,
		retry: refresh,
		flush: drain,
		dispose() {
			disposed = true;
			stopChanges();
			stopActions();
		},
	};
}
