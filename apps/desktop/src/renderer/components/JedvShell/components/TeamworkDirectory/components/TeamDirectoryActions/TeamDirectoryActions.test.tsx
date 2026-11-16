import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Team } from "../../../../hooks/useTeamwork";
import { TeamDirectoryActions } from "./TeamDirectoryActions";

afterEach(cleanup);
const team = { id: "team", name: "Fix sidebar", status: "active" } as Team;

test("delete requires explicit confirmation and targets the selected team", async () => {
	const onDelete = mock(async (_id: string) => {});
	const screen = render(
		<TeamDirectoryActions
			team={team}
			disabled={false}
			deleteSupported
			onDelete={onDelete}
		/>,
	);
	fireEvent.keyDown(
		screen.getByRole("button", { name: "Actions for Fix sidebar" }),
		{ key: "Enter" },
	);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Delete team" }));
	await screen.findByRole("alertdialog");
	expect(onDelete).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await waitFor(() => expect(onDelete).toHaveBeenCalledWith("team"));
});

test("connection loss after opening confirmation blocks deletion and keeps recovery visible", async () => {
	const onDelete = mock(async (_id: string) => {});
	const screen = render(
		<TeamDirectoryActions
			team={team}
			disabled={false}
			deleteSupported
			onDelete={onDelete}
		/>,
	);
	fireEvent.keyDown(
		screen.getByRole("button", { name: "Actions for Fix sidebar" }),
		{ key: "Enter" },
	);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Delete team" }));
	await screen.findByRole("alertdialog");
	screen.rerender(
		<TeamDirectoryActions
			team={team}
			disabled
			deleteSupported
			onDelete={onDelete}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
	await screen.findByRole("alert");
	expect(onDelete).not.toHaveBeenCalled();
	expect(screen.getByRole("alertdialog")).toBeTruthy();
});
