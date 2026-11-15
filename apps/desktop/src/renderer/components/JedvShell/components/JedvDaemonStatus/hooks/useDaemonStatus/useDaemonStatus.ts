import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { LocalClient } from "../../../../local-client";
export function useDaemonStatus({
	client,
	hostUrl,
	active = true,
}: {
	client: LocalClient;
	hostUrl: string;
	active?: boolean;
}) {
	const { t } = useLingui(),
		cache = useQueryClient();
	const scope = useRef<string | null>(hostUrl);
	scope.current = hostUrl;
	const busy = useRef<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const versions = useQuery({
		queryKey: ["jedv", hostUrl, "daemon-update"],
		queryFn: () => client.terminal.daemon.getUpdateStatus.query(),
		enabled: active,
		retry: false,
		refetchOnWindowFocus: true,
	});
	const sessions = useQuery({
		queryKey: ["jedv", hostUrl, "daemon-sessions"],
		queryFn: () => client.terminal.daemon.listSessions.query(),
		enabled: active,
		retry: false,
		refetchInterval: active ? 5000 : false,
	});
	const health = useQuery({
		queryKey: ["jedv", hostUrl, "daemon-health"],
		queryFn: () => client.terminal.daemon.getHealth.query(),
		enabled: active,
		retry: false,
		refetchInterval: active ? 5000 : false,
	});
	useEffect(() => {
		scope.current = hostUrl;
		setNotice(null);
		return () => {
			if (scope.current === hostUrl) scope.current = null;
		};
	}, [hostUrl]);
	const refresh = async () => {
		await Promise.all([
			versions.refetch({ throwOnError: true }),
			health.refetch({ throwOnError: true }),
			sessions.refetch({ throwOnError: true }),
		]);
	};
	const action = useMutation({
		mutationKey: ["jedv", hostUrl, "daemon-action"],
		mutationFn: async (kind: "update" | "restart") => {
			if (busy.current === hostUrl)
				throw new Error(
					t({ message: "A daemon operation is already in progress" }),
				);
			busy.current = hostUrl;
			try {
				if (kind === "update") {
					const result = await client.terminal.daemon.update.mutate();
					if (!result.ok) throw new Error(result.reason);
				} else await client.terminal.daemon.restart.mutate();
				return kind;
			} finally {
				if (busy.current === hostUrl) busy.current = null;
			}
		},
		onSuccess: (kind) => {
			if (scope.current === hostUrl)
				setNotice(
					kind === "update"
						? t({ message: "Daemon updated. Sessions preserved." })
						: t({ message: "Daemon restarted. All sessions were closed." }),
				);
		},
		onSettled: () => {
			void cache.invalidateQueries({
				queryKey: ["jedv", hostUrl, "daemon-update"],
			});
			void cache.invalidateQueries({
				queryKey: ["jedv", hostUrl, "daemon-health"],
			});
		},
	});
	return { versions, health, sessions, action, notice, refresh };
}
