import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { HostDb } from "../../../../db";
import { workspaceSetup, workspaces } from "../../../../db/schema";
import {
	getTerminalBaseEnv,
	resolveLaunchShell,
	waitForTerminalBaseEnv,
} from "../../../../terminal/env";
import {
	createTerminalSessionInternal,
	supportsOneShotSetup,
} from "../../../../terminal/terminal";
import type { HostServiceContext } from "../../../../types";

export async function assertWorkspaceSetupSupported(): Promise<void> {
	await waitForTerminalBaseEnv();
	if (!supportsOneShotSetup(resolveLaunchShell(getTerminalBaseEnv())))
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Tracked workspace setup requires a supported Unix shell.",
		});
}

export function getWorkspaceSetupStatus(db: HostDb, workspaceId: string) {
	return (
		db
			.select()
			.from(workspaceSetup)
			.where(eq(workspaceSetup.workspaceId, workspaceId))
			.get() ?? null
	);
}

export function recordWorkspaceSetupStart(
	db: HostDb,
	workspaceId: string,
	terminalId: string,
) {
	const value = {
		workspaceId,
		terminalId,
		status: "running" as const,
		exitCode: null,
		exitSignal: null,
		startedAt: Date.now(),
		finishedAt: null,
	};
	db.insert(workspaceSetup)
		.values(value)
		.onConflictDoUpdate({ target: workspaceSetup.workspaceId, set: value })
		.run();
}

export function recordWorkspaceSetupNotRequired(
	db: HostDb,
	workspaceId: string,
) {
	const value = {
		workspaceId,
		terminalId: null,
		status: "not-required" as const,
		exitCode: null,
		exitSignal: null,
		startedAt: null,
		finishedAt: Date.now(),
	};
	db.insert(workspaceSetup)
		.values(value)
		.onConflictDoUpdate({ target: workspaceSetup.workspaceId, set: value })
		.run();
}

export function recordUntrackedWorkspaceSetup(
	db: HostDb,
	workspaceId: string,
	terminalId: string,
) {
	db.update(workspaceSetup)
		.set({
			terminalId,
			status: "unknown",
			exitCode: null,
			exitSignal: null,
			startedAt: Date.now(),
			finishedAt: null,
		})
		.where(eq(workspaceSetup.workspaceId, workspaceId))
		.run();
}

export function recordWorkspaceSetupExit(
	db: HostDb,
	workspaceId: string,
	terminalId: string,
	info: { code: number | null; signal: number | null },
) {
	const signalled = info.signal != null && info.signal !== 0;
	const status =
		info.code === 0 && !signalled
			? "succeeded"
			: info.code != null || signalled
				? "failed"
				: "unknown";
	db.update(workspaceSetup)
		.set({
			status,
			exitCode: info.code,
			exitSignal: info.signal,
			finishedAt: Date.now(),
		})
		.where(
			and(
				eq(workspaceSetup.workspaceId, workspaceId),
				eq(workspaceSetup.terminalId, terminalId),
				eq(workspaceSetup.status, "running"),
			),
		)
		.run();
}

export function recordWorkspaceSetupUnavailable(
	db: HostDb,
	workspaceId: string,
	terminalId: string,
	status: "unknown" | "failed",
) {
	db.update(workspaceSetup)
		.set({ status, exitCode: null, exitSignal: null, finishedAt: Date.now() })
		.where(
			and(
				eq(workspaceSetup.workspaceId, workspaceId),
				eq(workspaceSetup.terminalId, terminalId),
				eq(workspaceSetup.status, "running"),
			),
		)
		.run();
}

export async function recoverWorkspaceSetupTerminals(
	ctx: Pick<HostServiceContext, "db" | "eventBus">,
	createTerminal: typeof createTerminalSessionInternal = createTerminalSessionInternal,
): Promise<void> {
	const rows = ctx.db
		.select({
			workspaceId: workspaceSetup.workspaceId,
			terminalId: workspaceSetup.terminalId,
		})
		.from(workspaceSetup)
		.innerJoin(workspaces, eq(workspaceSetup.workspaceId, workspaces.id))
		.where(
			and(
				eq(workspaceSetup.status, "running"),
				isNotNull(workspaceSetup.terminalId),
				isNull(workspaces.archivedAt),
			),
		)
		.all();
	for (const row of rows) {
		if (!row.terminalId) continue;
		const terminalId = row.terminalId;
		try {
			const result = await createTerminal({
				terminalId,
				workspaceId: row.workspaceId,
				db: ctx.db,
				eventBus: ctx.eventBus,
				adoptOnly: true,
				oneShotSetup: {
					onLost: () =>
						recordWorkspaceSetupUnavailable(
							ctx.db,
							row.workspaceId,
							terminalId,
							"unknown",
						),
					onExit: (info) =>
						recordWorkspaceSetupExit(ctx.db, row.workspaceId, terminalId, info),
				},
			});
			if (!("error" in result)) continue;
			console.warn("[workspace-setup] setup exit evidence unavailable", {
				workspaceId: row.workspaceId,
				terminalId,
				error: result.error,
			});
		} catch (error) {
			console.warn("[workspace-setup] could not recover setup terminal", {
				workspaceId: row.workspaceId,
				terminalId,
				error,
			});
		}
		recordWorkspaceSetupUnavailable(
			ctx.db,
			row.workspaceId,
			terminalId,
			"unknown",
		);
	}
}
