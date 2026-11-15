import { z } from "zod";
import { protectedProcedure } from "../../../index";
import { fetchPullRequestContent } from "../shared/fetch-pull-request-content";
import { evictPullRequestContent } from "../shared/pull-request-content-cache";

export const getContentByRepo = protectedProcedure
	.input(
		z.object({
			repoFullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
			prNumber: z.number().int().positive(),
			forceRefresh: z.boolean().optional().default(false),
		}),
	)
	.query(({ input }) => {
		const [owner, name] = input.repoFullName.split("/");
		const repo = { owner: owner ?? "", name: name ?? "" };
		if (input.forceRefresh) evictPullRequestContent(repo, input.prNumber);
		return fetchPullRequestContent(repo, input.prNumber);
	});
