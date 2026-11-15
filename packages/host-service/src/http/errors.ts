import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

export function httpFailure(error: unknown): {
	status: ContentfulStatusCode;
	message: string;
} {
	if (error instanceof ZodError || error instanceof SyntaxError)
		return { status: 400, message: "Invalid request payload" };
	if (error instanceof TRPCError)
		return {
			status: getHTTPStatusCodeFromError(error) as ContentfulStatusCode,
			message: error.message,
		};
	return { status: 500, message: "Request could not be completed" };
}
