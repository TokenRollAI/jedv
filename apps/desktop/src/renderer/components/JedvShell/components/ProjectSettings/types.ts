import type { ProjectActionContext } from "../JedvProjectActions";
export type ProjectSettingsContext = Pick<
	ProjectActionContext,
	"client" | "hostUrl"
> & { hostLabel?: string; isRemote?: boolean; remote?: unknown };
export function settingsTarget(
	context: ProjectSettingsContext,
): ProjectActionContext {
	return {
		...context,
		hostLabel: context.hostLabel ?? context.hostUrl,
		isRemote: context.isRemote ?? !!context.remote,
	};
}
