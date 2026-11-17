import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { useTeamwork } from "../../hooks/useTeamwork";
import { TeamworkDirectory } from "./TeamworkDirectory";

afterEach(cleanup);

test("teamwork section header exposes explicit + Create team action", () => {
	const onCreateTeam = mock(() => {});
	const index = {
		supported: true,
		capabilities: {
			isPending: false,
			isError: false,
			data: { features: {} },
			refetch: async () => {},
		},
		list: {
			isPending: false,
			isError: false,
			isSuccess: true,
			data: [],
			refetch: async () => {},
		},
		deleteTeam: async () => {},
	} as unknown as ReturnType<typeof useTeamwork>;
	const view = render(
		<TeamworkDirectory
			index={index}
			selectedId={null}
			active={false}
			onSelect={() => {}}
			onCreateTeam={onCreateTeam}
		/>,
	);
	fireEvent.click(view.getByRole("button", { name: "Create team" }));
	expect(onCreateTeam).toHaveBeenCalledTimes(1);
});
