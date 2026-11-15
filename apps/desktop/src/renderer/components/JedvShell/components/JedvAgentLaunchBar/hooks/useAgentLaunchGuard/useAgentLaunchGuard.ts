import { useEffect, useRef, useState } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import type { LocalClient } from "../../../../local-client";
import { checkSetupBeforeLaunch } from "../../utils/check-setup";
import type { WorkspaceSetupStatus } from "../../utils/setup-state";
export interface SetupLaunchBlocker {
	workspaceId: string;
	state: WorkspaceSetupStatus;
	error: string | null;
}
export function useAgentLaunchGuard({
	client,
	hostUrl,
}: {
	client: LocalClient | null;
	hostUrl: string | null;
}) {
	const [blocker, setBlocker] = useState<SetupLaunchBlocker | null>(null);
	const [checking, setChecking] = useState(false);
	const sequence = useRef(0);
	const scope = useRef({ client, hostUrl });
	scope.current = { client, hostUrl };
	useEffect(() => {
		if (scope.current.client !== client || scope.current.hostUrl !== hostUrl)
			return;
		sequence.current++;
		setBlocker(null);
		setChecking(false);
		return () => {
			sequence.current++;
		};
	}, [client, hostUrl]);
	const check = async (workspaceId: string) => {
		const original = scope.current;
		const request = ++sequence.current;
		setChecking(true);
		try {
			const launchClient = original.client;
			if (!launchClient) return false;
			const result = await checkSetupBeforeLaunch({
				readWait: () =>
					electronTrpcClient.settings.getWaitForSetupBeforeAgent.query(),
				readSetup: () =>
					launchClient.workspaces.getSetupStatus.query({ workspaceId }),
				isCurrent: () =>
					request === sequence.current &&
					scope.current.client === original.client &&
					scope.current.hostUrl === original.hostUrl,
			});
			if (result.stale) return false;
			setBlocker(
				result.allowed
					? null
					: { workspaceId, state: result.state, error: null },
			);
			return result.allowed;
		} catch (cause) {
			if (
				request === sequence.current &&
				scope.current.client === original.client &&
				scope.current.hostUrl === original.hostUrl
			)
				setBlocker({
					workspaceId,
					state: null,
					error: cause instanceof Error ? cause.message : String(cause),
				});
			return false;
		} finally {
			if (request === sequence.current) setChecking(false);
		}
	};
	return {
		beforeLaunch: check,
		blocker,
		checking,
		refresh: async () => {
			if (blocker) await check(blocker.workspaceId);
		},
		dismiss: () => {
			sequence.current++;
			setBlocker(null);
			setChecking(false);
		},
	};
}
