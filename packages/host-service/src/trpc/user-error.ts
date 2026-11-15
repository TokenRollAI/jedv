import { TRPCError } from "@trpc/server";

interface I18nErrorCause {
	i18nKey: string;
	i18nParams?: Record<string, string | number>;
}

export function isI18nErrorCause(cause: unknown): cause is I18nErrorCause {
	if (
		!cause ||
		typeof cause !== "object" ||
		!("i18nKey" in cause) ||
		typeof cause.i18nKey !== "string"
	)
		return false;
	if (!("i18nParams" in cause) || cause.i18nParams === undefined) return true;
	return (
		cause.i18nParams !== null &&
		typeof cause.i18nParams === "object" &&
		!Array.isArray(cause.i18nParams) &&
		Object.values(cause.i18nParams).every(
			(value) => typeof value === "string" || typeof value === "number",
		)
	);
}

export function userError(input: {
	code: TRPCError["code"];
	message: string;
	i18nKey: string;
	params?: Record<string, string | number>;
}): TRPCError {
	return new TRPCError({
		code: input.code,
		message: input.message,
		cause: {
			i18nKey: input.i18nKey,
			i18nParams: input.params,
		} satisfies I18nErrorCause,
	});
}
