import { skipToken, useQuery } from "@tanstack/react-query";
import type { LocalClient } from "../../local-client";
export const butlerQueryKey = (hostUrl: string) =>
	["jedv", hostUrl, "butler"] as const;
export function useButlerInbox(
	client: LocalClient | null,
	hostUrl: string | null,
	connected: boolean,
) {
	const key = butlerQueryKey(hostUrl ?? "disconnected");
	const capabilities = useQuery({
		queryKey: [...key, "capabilities"],
		queryFn: client ? () => client.butler.capabilities.query() : skipToken,
		enabled: connected && !!client,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 60_000,
	});
	const supported =
		capabilities.data?.protocolVersion === 1 && !capabilities.isError;
	const attentionSupported =
		supported && capabilities.data?.features?.attention === true;
	const inbox = useQuery({
		queryKey: [...key, "attention", "open"],
		queryFn: client
			? () => client.butler.attention.query({ view: "open", limit: 100 })
			: skipToken,
		enabled: connected && attentionSupported && !!client,
		retry: false,
		gcTime: 30_000,
		refetchInterval: 15_000,
	});
	return {
		capabilities,
		supported,
		attentionSupported,
		inbox,
		groups: inbox.data?.groups ?? [],
		approvals: inbox.data?.approvals ?? [],
		actionable:
			connected && attentionSupported && !inbox.isError
				? (inbox.data?.badge.count ?? 0)
				: 0,
	};
}
