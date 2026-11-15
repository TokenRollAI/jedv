import type { LocalClient } from "../../../../../local-client";
import { nativeProvider } from "../types";
import { selectionForBinding } from "./selection";

type Candidate = Awaited<
	ReturnType<LocalClient["terminalAgents"]["resumeCandidates"]["query"]>
>[number];
export class ExistingSessionError extends Error {
	constructor(
		readonly reason:
			| "unsupported"
			| "strict-unavailable"
			| "not-resumed"
			| "identity-changed",
	) {
		super(reason);
	}
}
export async function resumeExistingCli(
	client: Pick<LocalClient, "terminalAgents">,
	workspaceId: string,
	candidate: Candidate,
) {
	const candidates = await client.terminalAgents.resumeCandidates.query({
		workspaceId,
	});
	const current = candidates.find(
		(row) => row.terminalId === candidate.terminalId,
	);
	if (
		!current ||
		current.provider !== candidate.provider ||
		current.nativeSessionId !== candidate.nativeSessionId
	)
		throw new ExistingSessionError("identity-changed");
	if (!current.resumeSupported) throw new ExistingSessionError("unsupported");
	let terminalId: string | undefined;
	const provider = nativeProvider(candidate.provider);
	if (provider) {
		const state = await client.terminalAgents.queryNativeSession.query({
			workspaceId,
			provider,
			nativeSessionId: candidate.nativeSessionId,
			agentConfigId: candidate.definitionId ?? undefined,
			terminalId: candidate.terminalId,
		});
		if (
			!state.supported ||
			state.source !== "native-session" ||
			state.nativeSessionId !== candidate.nativeSessionId ||
			state.provider !== provider
		)
			throw new ExistingSessionError("unsupported");
		const result = await client.terminalAgents.openNativeCli.mutate({
			workspaceId,
			provider,
			nativeSessionId: candidate.nativeSessionId,
			agentConfigId: candidate.definitionId ?? undefined,
			expectedLeaseEpoch: state.leaseEpoch,
		});
		terminalId = result.terminalId ?? undefined;
	} else {
		const options = {
			workspaceId,
			terminalId: candidate.terminalId,
			expectedNativeSessionId: candidate.nativeSessionId,
		};
		try {
			const successor =
				await client.terminalAgents.resumedSuccessorStrict.query(options);
			const resumed =
				successor ?? (await client.terminalAgents.resumeStrict.mutate(options));
			terminalId = "terminalId" in resumed ? resumed.terminalId : undefined;
		} catch (cause) {
			if (
				cause &&
				typeof cause === "object" &&
				"data" in cause &&
				(cause.data as { code?: string } | null)?.code === "NOT_FOUND"
			)
				throw new ExistingSessionError("strict-unavailable");
			throw cause;
		}
	}
	if (!terminalId) throw new ExistingSessionError("not-resumed");
	const verified = await client.terminalAgents.get.query({
		workspaceId,
		terminalId,
	});
	if (
		!verified ||
		verified.chatSessionId ||
		verified.agentId !== candidate.provider ||
		verified.agentSessionId !== candidate.nativeSessionId
	)
		throw new ExistingSessionError("identity-changed");
	return selectionForBinding(verified);
}
