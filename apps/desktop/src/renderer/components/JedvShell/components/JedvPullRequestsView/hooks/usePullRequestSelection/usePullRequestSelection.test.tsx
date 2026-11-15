import { afterEach, expect, test } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import type { PullRequestTarget } from "../../types";
import { usePullRequestSelection } from "./usePullRequestSelection";

afterEach(cleanup);
test("an existing PR view follows a new target while an absent target preserves its user's selection", () => {
	const first: PullRequestTarget = {
		projectId: "p",
		owner: "owner",
		repo: "repo",
		number: 1,
		title: "First",
	};
	const second = { ...first, number: 2, title: "Second" };
	const initialProps: { host: string; target?: PullRequestTarget } = {
		host: "http://one",
		target: first,
	};
	const view = renderHook(
		({ host, target }: { host: string; target?: PullRequestTarget }) =>
			usePullRequestSelection(host, target),
		{ initialProps },
	);
	expect(view.result.current.selected).toEqual(first);
	view.rerender({ host: "http://one", target: second });
	expect(view.result.current.selected).toEqual(second);
	view.rerender({ host: "http://one", target: undefined });
	expect(view.result.current.selected).toEqual(second);
	view.rerender({ host: "http://other", target: undefined });
	expect(view.result.current.selected).toBeNull();
});
