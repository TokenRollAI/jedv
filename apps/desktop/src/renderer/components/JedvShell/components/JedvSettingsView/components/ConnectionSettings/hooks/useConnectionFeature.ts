import { useQuery } from "@tanstack/react-query";
import type { JedvParityViewContext } from "../../../../../parity-types";
export const connectionFeatureKey = (hostUrl: string, feature: string) =>
	["jedv", hostUrl, feature] as const;
export function useConnectionFeature(
	{ client, hostUrl }: Pick<JedvParityViewContext, "client" | "hostUrl">,
	feature: "mobileAuth" | "peers" | "declarativeSlots",
) {
	const query = useQuery({
		queryKey: [...connectionFeatureKey(hostUrl, feature), "capabilities"],
		queryFn: () => client[feature].capabilities.query(),
		retry: false,
		gcTime: 30_000,
		refetchInterval: 60_000,
	});
	return {
		query,
		supported: query.data?.protocolVersion === 1 && !query.isError,
	};
}
