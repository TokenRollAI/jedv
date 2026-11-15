import { msg } from "@lingui/core/macro";
import { i18n } from "./index";

export const serverErrorMessages: Record<
	string,
	(params?: Record<string, unknown>) => string
> = {
	"serverError.workspaces.restoreBranchMissing": (params) =>
		i18n._(
			msg({
				message: `Branch "${params?.branch}" is not on this device or on ${params?.remote}. Only pushed commits can be restored.`,
			}),
		),
	"serverError.workspaces.restoreFetchFailed": (params) =>
		i18n._(
			msg({
				message: `Could not reach ${params?.remote} to look for branch "${params?.branch}". Check your connection and access to ${params?.remote}, then try again.`,
			}),
		),
};
