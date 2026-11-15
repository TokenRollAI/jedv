import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { HostAgentConfig } from "../../../../types";
import { SessionLaunchDialog } from "./SessionLaunchDialog";

afterEach(cleanup);
test("Run agent offers configured agents independently of terminal script presets", () => {
	const config = {
		id: "claude",
		presetId: "claude",
		label: "Claude",
	} as HostAgentConfig;
	const launch = mock((_config: HostAgentConfig) => {});
	const props = {
		configs: [config],
		disabled: false,
		onLaunch: launch,
		onSettings: () => {},
		onClose: () => {},
	};
	const view = render(<SessionLaunchDialog {...props} />);
	fireEvent.click(view.getByRole("button", { name: "Claude" }));
	expect(launch).toHaveBeenCalledWith(config);
	view.rerender(<SessionLaunchDialog {...props} disabled />);
	expect(
		(view.getByRole("button", { name: "Claude" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
});
