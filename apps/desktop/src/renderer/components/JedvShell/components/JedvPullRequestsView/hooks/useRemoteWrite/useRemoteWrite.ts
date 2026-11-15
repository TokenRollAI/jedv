import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
export function useRemoteWrite(
	options: {
		initialBlocked?: boolean;
		onBlockedChange?(blocked: boolean): void;
	} = {},
) {
	const { t } = useLingui();
	const gate = useRef({
		blocked: options.initialBlocked ?? false,
		pending: false,
	});
	const [blocked, setBlocked] = useState(options.initialBlocked ?? false),
		[refreshing, setRefreshing] = useState(false);
	const run = async <T>(write: () => Promise<T>): Promise<T> => {
		if (gate.current.blocked || gate.current.pending)
			throw new Error(
				t({ message: "Result unknown. Refresh before retrying." }),
			);
		gate.current.pending = true;
		try {
			return await write();
		} catch (error) {
			gate.current.blocked = true;
			setBlocked(true);
			options.onBlockedChange?.(true);
			throw error;
		} finally {
			gate.current.pending = false;
		}
	};
	const refresh = async (read: () => Promise<unknown>) => {
		if (gate.current.pending) return;
		setRefreshing(true);
		try {
			await read();
			gate.current.blocked = false;
			setBlocked(false);
			options.onBlockedChange?.(false);
		} finally {
			setRefreshing(false);
		}
	};
	return { blocked, refreshing, run, refresh };
}
