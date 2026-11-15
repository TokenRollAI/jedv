import type { LocalClient } from "../../local-client";
export type PullRequest = Awaited<
	ReturnType<LocalClient["github"]["listPRs"]["query"]>
>[number];
export interface PullRequestTarget {
	projectId: string;
	owner: string;
	repo: string;
	number: number;
	title: string;
}
export type PullRequestContent = Awaited<
	ReturnType<LocalClient["pullRequests"]["getContentByRepo"]["query"]>
>;
