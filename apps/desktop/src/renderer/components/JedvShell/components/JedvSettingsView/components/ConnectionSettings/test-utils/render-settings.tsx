import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import type { ReactNode } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
export function renderConnectionSettings(content: ReactNode) {
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const ipc = electronTrpc.createClient({
		links: [
			() => () =>
				observable((emit) => {
					emit.next({
						result: { data: { state: "not-installed", health: [] } },
					});
					emit.complete();
				}),
		],
	});
	const screen = render(
		<QueryClientProvider client={cache}>
			<electronTrpc.Provider client={ipc} queryClient={cache}>
				{content}
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	return { screen, cache };
}
