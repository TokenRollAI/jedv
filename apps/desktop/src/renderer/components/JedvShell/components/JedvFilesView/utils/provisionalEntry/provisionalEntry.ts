export interface ProvisionalEntry {
	key: string;
	absolutePath: string;
	mode: "file" | "folder";
	revision?: string;
	rootPath: string;
	versionToken: number;
}

export type ProvisionalEvent =
	| { type: "created"; entry: ProvisionalEntry }
	| { type: "renamed"; sourceKey: string }
	| { type: "rename-error" }
	| { type: "removed"; path: string; rootPath: string; versionToken: number }
	| { type: "workspace-changed" };

export type ProvisionalAction =
	| { type: "none" }
	| { type: "cleanup"; entry: ProvisionalEntry };

const NONE: { state: ProvisionalEntry | null; action: ProvisionalAction } = {
	state: null,
	action: { type: "none" },
};

export function reduceProvisional(
	state: ProvisionalEntry | null,
	event: ProvisionalEvent,
): { state: ProvisionalEntry | null; action: ProvisionalAction } {
	switch (event.type) {
		case "created":
			return { state: event.entry, action: { type: "none" } };
		case "renamed":
			return state?.key === event.sourceKey
				? NONE
				: { state, action: { type: "none" } };
		case "rename-error":
			return NONE;
		case "removed":
			if (
				state === null ||
				state.key !== event.path ||
				state.rootPath !== event.rootPath ||
				state.versionToken !== event.versionToken
			) {
				return { state, action: { type: "none" } };
			}
			return { state: null, action: { type: "cleanup", entry: state } };
		case "workspace-changed":
			return NONE;
	}
}
