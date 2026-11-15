import type { LocalClient } from "../../local-client";
export type WorkspacePortRowData = Awaited<
	ReturnType<LocalClient["ports"]["getAll"]["query"]>
>[number];
