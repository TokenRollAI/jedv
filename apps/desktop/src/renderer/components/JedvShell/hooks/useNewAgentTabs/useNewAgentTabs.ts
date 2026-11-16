import { useEffect, useMemo } from "react";
import type { ActiveBinding } from "../../components/ActiveWorkspaceSwitcher/active-workspaces";
import {
	openNewAgentTab,
	type TerminalLayoutStore,
} from "../../components/JedvTerminalWorkspace/layout";
import type { TerminalSession } from "../../types";
import { createAgentTabDiscovery } from "./discovery";

export function useNewAgentTabs(input: {
	store: TerminalLayoutStore;
	hostUrl: string | null;
	workspaceId: string | null;
	ready: boolean;
	sessions: TerminalSession[];
	bindings: ActiveBinding[];
}) {
	const { store, hostUrl, workspaceId, ready, sessions, bindings } = input;
	const discover = useMemo(() => {
		if (!hostUrl || !workspaceId || !store) return null;
		return createAgentTabDiscovery(workspaceId);
	}, [store, hostUrl, workspaceId]);
	useEffect(() => {
		if (!discover) return;
		for (const session of discover({ ready, sessions, bindings })) {
			openNewAgentTab(store, session);
		}
	}, [discover, store, ready, sessions, bindings]);
}
