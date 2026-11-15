import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

export function useAutoUpdateStatus() {
	const utils = electronTrpc.useUtils();
	const query = electronTrpc.autoUpdate.getStatus.useQuery(undefined, {
		retry: false,
	});
	const [subscriptionError, setSubscriptionError] = useState<Error | null>(
		null,
	);
	electronTrpc.autoUpdate.subscribe.useSubscription(undefined, {
		onData: (event) => {
			setSubscriptionError(null);
			utils.autoUpdate.getStatus.setData(undefined, event);
		},
		onError: (error) => setSubscriptionError(new Error(error.message)),
	});
	return { ...query, error: query.error ?? subscriptionError };
}
