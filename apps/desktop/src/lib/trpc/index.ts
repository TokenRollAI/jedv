import { createTRPCReact } from "@trpc/react-query";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type { AppRouter } from "./routers";

function structuredCause(cause: unknown): Record<string, unknown> | undefined {
	if (
		cause &&
		typeof cause === "object" &&
		typeof (cause as { kind?: unknown }).kind === "string"
	) {
		// Rebuild as a plain object: tRPC wraps non-Error causes in an
		// UnknownCauseError whose custom fields superjson would otherwise drop.
		return { ...(cause as Record<string, unknown>) };
	}
	return undefined;
}

/**
 * Core tRPC initialization
 * This provides the base router and procedure builders used by all routers
 */
const t = initTRPC.context<TrpcContext>().create({
	transformer: superjson,
	isServer: true,
	// tRPC strips `cause` during serialization; pass kind-discriminated causes
	// through so the renderer can branch on them instead of parsing messages.
	errorFormatter({ shape, error }) {
		const cause = structuredCause(error.cause);
		return {
			...shape,
			data: {
				...shape.data,
				...(cause ? { cause } : {}),
			},
		};
	},
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;
export const trpc = createTRPCReact<AppRouter>();
