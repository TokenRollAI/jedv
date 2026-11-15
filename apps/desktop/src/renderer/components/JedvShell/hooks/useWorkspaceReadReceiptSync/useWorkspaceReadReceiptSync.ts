import { toast } from "@jedv/ui/sonner";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { useWorkspaceReadReceipts } from "../../components/JedvWorkspacesBoard/stores/read-receipts";
import { createReadReceiptSync } from "./sync";

export function useWorkspaceReadReceiptSync() {
	const { t } = useLingui();
	const [ready, setReady] = useState(false);
	const sync = useRef<ReturnType<typeof createReadReceiptSync> | null>(null);
	const error = useWorkspaceReadReceipts((state) => state.syncError);
	useEffect(() => {
		const service = createReadReceiptSync(
			{
				get: () => electronTrpcClient.uiState.readReceipts.get.query(),
				set: (change) =>
					electronTrpcClient.uiState.readReceipts.set.mutate(change),
				subscribe: (onChange, onReconnect, onError) => {
					const subscription =
						electronTrpcClient.uiState.readReceipts.change.subscribe(
							undefined,
							{
								onData: onChange,
								onStarted: onReconnect,
								onError,
							},
						);
					return () => subscription.unsubscribe();
				},
			},
			setReady,
		);
		sync.current = service;
		void service.start();
		return () => {
			service.dispose();
			sync.current = null;
		};
	}, []);
	useEffect(() => {
		if (error)
			toast.error(t({ message: "Workspace read state could not be saved." }), {
				description: error.message,
			});
	}, [error, t]);
	return {
		ready,
		error,
		retry: () => sync.current?.retry() ?? Promise.resolve(),
	};
}
