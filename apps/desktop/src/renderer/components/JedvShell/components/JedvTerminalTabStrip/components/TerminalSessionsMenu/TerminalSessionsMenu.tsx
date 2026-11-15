import type { TerminalSessionsMenuProps } from "../../types";
import { useTerminalSessionsMenu } from "./useTerminalSessionsMenu";
export function TerminalSessionsMenu(props: TerminalSessionsMenuProps) {
	const menu = useTerminalSessionsMenu(props, true);
	return (
		<>
			{menu.menu}
			{menu.dialogs}
		</>
	);
}
