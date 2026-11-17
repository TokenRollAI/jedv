import { afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { JedvSidebarHeader } from "./JedvSidebarHeader";

afterEach(cleanup);

test("clicking Jedv header brand button invokes onHome escape hatch", () => {
	const onHome = mock(() => {});
	const cache = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const ipc = electronTrpc.createClient({
		links: [
			() => () =>
				observable((emit) => {
					emit.next({ result: { data: null } });
					emit.complete();
				}),
		],
	});
	const view = render(
		<QueryClientProvider client={cache}>
			<electronTrpc.Provider client={ipc} queryClient={cache}>
				<JedvSidebarHeader
					host="Local"
					connected
					collapsed={false}
					onToggle={() => {}}
					onLocal={() => {}}
					onConnect={() => {}}
					onRestart={() => {}}
					onHome={onHome}
					onProjectAction={() => {}}
				/>
			</electronTrpc.Provider>
		</QueryClientProvider>,
	);
	fireEvent.click(view.getByRole("button", { name: "Home" }));
	expect(onHome).toHaveBeenCalledTimes(1);
	view.unmount();
});
