import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import {
	inaccessiblePathMessage,
	isPermissionDenied,
	permissionDeniedPath,
} from "../runtime/path-state";
import type { HostServiceContext } from "../types";
import { readErrorDiagnostics } from "./error-diagnostics";
import {
	type DeleteInProgressCause,
	type GitEnvironmentReason,
	isDeleteInProgressCause,
	isGitEnvironmentCause,
	isProjectDirMissingCause,
	isProjectNotSetupCause,
	isTeardownFailureCause,
	type ProjectDirMissingCause,
	type ProjectNotSetupCause,
	type TeardownFailureCause,
} from "./error-types";
import { isI18nErrorCause } from "./user-error";

export interface RouterMeta {
	/**
	 * Per-procedure timeout in milliseconds, applied to query procedures
	 * via `queryProcedure`. Defaults to 5_000 when omitted. Set higher for
	 * procedures that legitimately take longer (e.g. searching large
	 * histories or shelling out to long-running commands).
	 */
	timeoutMs?: number;
}

const t = initTRPC
	.context<HostServiceContext>()
	.meta<RouterMeta>()
	.create({
		transformer: superjson,
		errorFormatter({ shape, error }) {
			// tRPC wraps non-Error `cause` values via getCauseFromUnknown() into a
			// synthetic UnknownCauseError that carries the original fields as own
			// properties. Superjson then serializes it as an Error (message/stack
			// only) and drops our fields. Re-build a plain object so the wire
			// format keeps `kind`, `exitCode`, `outputTail`, etc.
			const teardownFailure: TeardownFailureCause | undefined =
				isTeardownFailureCause(error.cause)
					? {
							kind: "TEARDOWN_FAILED",
							exitCode: error.cause.exitCode,
							signal: error.cause.signal,
							timedOut: error.cause.timedOut,
							outputTail: error.cause.outputTail,
						}
					: undefined;
			const projectNotSetup: ProjectNotSetupCause | undefined =
				isProjectNotSetupCause(error.cause)
					? {
							kind: "PROJECT_NOT_SETUP",
							projectId: error.cause.projectId,
						}
					: undefined;
			const projectDirMissing: ProjectDirMissingCause | undefined =
				isProjectDirMissingCause(error.cause)
					? { kind: "PROJECT_DIR_MISSING", repoPath: error.cause.repoPath }
					: undefined;
			const deleteInProgress: DeleteInProgressCause | undefined =
				isDeleteInProgressCause(error.cause)
					? { kind: "DELETE_IN_PROGRESS" }
					: undefined;
			const gitEnvironment:
				| { kind: "GIT_ENVIRONMENT"; reason: GitEnvironmentReason | null }
				| undefined = isGitEnvironmentCause(error.cause)
				? { kind: "GIT_ENVIRONMENT", reason: error.cause.reason ?? null }
				: undefined;
			const i18nCause = isI18nErrorCause(error.cause) ? error.cause : null;
			return {
				...shape,
				data: {
					...shape.data,
					teardownFailure,
					projectNotSetup,
					projectDirMissing,
					deleteInProgress,
					gitEnvironment,
					i18nKey: i18nCause?.i18nKey ?? null,
					i18nParams: i18nCause?.i18nParams ?? null,
				},
			};
		},
	});

const diagnosticMiddleware = t.middleware(async ({ next, path, type }) => {
	const result = await next();
	if (!result.ok && result.error.code === "INTERNAL_SERVER_ERROR") {
		const error = result.error;
		const originalError = error.cause instanceof Error ? error.cause : error;
		console.error("[host-service] procedure failed", {
			path,
			type,
			error: originalError,
			...readErrorDiagnostics(originalError),
		});
	}
	return result;
});

const permissionDeniedMiddleware = t.middleware(async ({ next }) => {
	const result = await next();
	if (
		!result.ok &&
		result.error.code === "INTERNAL_SERVER_ERROR" &&
		isPermissionDenied(result.error.cause)
	) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: inaccessiblePathMessage(
				permissionDeniedPath(result.error.cause),
			),
			cause: result.error.cause,
		});
	}
	return result;
});

const baseProcedure = t.procedure
	.use(diagnosticMiddleware)
	.use(permissionDeniedMiddleware);

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = baseProcedure;

export const protectedProcedure = baseProcedure.use(async ({ ctx, next }) => {
	if (!ctx.isAuthenticated) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Invalid or missing authentication token.",
		});
	}
	return next({ ctx });
});

const DEFAULT_QUERY_TIMEOUT_MS = 5_000;

const timeoutMiddleware = t.middleware(async ({ next, type, path, meta }) => {
	if (type !== "query") return next();
	const timeoutMs = meta?.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(
				new TRPCError({
					code: "TIMEOUT",
					message: `${path} timed out after ${timeoutMs}ms`,
				}),
			);
		}, timeoutMs);
	});

	try {
		return await Promise.race([next(), timeoutPromise]);
	} finally {
		if (timer) clearTimeout(timer);
	}
});

/**
 * Query procedures with a server-side timeout. Hung filesystem/git work
 * rejects after `meta.timeoutMs` (default 5s) so the renderer doesn't
 * spin forever. React Query is configured to retry on `TIMEOUT` errors.
 *
 * Use this for `.query` procedures only — mutations have variable
 * latency and shouldn't share a blanket budget.
 *
 * See `packages/host-service/QUERY_TIMEOUTS.md` for the policy and
 * current per-procedure budgets.
 */
export const queryProcedure = protectedProcedure.use(timeoutMiddleware);

export type {
	ProjectNotSetupCause,
	TeardownFailureCause,
} from "./error-types";
// INTERIM cross-runtime types via dist-types — see docs/interim-router-types.md
export type { AppRouter } from "./router";
