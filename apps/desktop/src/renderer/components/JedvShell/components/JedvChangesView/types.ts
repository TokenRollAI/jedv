import type { LocalClient } from "../../local-client";
export type ChangedFile = Awaited<
	ReturnType<LocalClient["git"]["getStatus"]["query"]>
>["unstaged"][number];
export type Branch = Awaited<
	ReturnType<LocalClient["git"]["listBranches"]["query"]>
>["branches"][number];
export type Commit = Awaited<
	ReturnType<LocalClient["git"]["listCommits"]["query"]>
>["commits"][number];
export type Category = "against-base" | "staged" | "unstaged" | "commit";
export type ChangesFilter =
	| { kind: "all" }
	| { kind: "uncommitted" }
	| { kind: "commit"; hash: string }
	| { kind: "range"; fromHash: string; toHash: string };
export type ChangesViewMode = "tree" | "folders";
export interface ChangeSelection {
	category: Category;
	path: string;
}
