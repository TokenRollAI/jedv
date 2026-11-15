import "./globals.css";
import "./styles/bundled-fonts";

import { createRouter } from "@tanstack/react-router";
import ReactDom from "react-dom/client";
import { RendererRouter } from "./components/RendererRouter";
import {
	cleanupBootErrorHandling,
	initBootErrorHandling,
	isBootErrorReported,
	markBootMounted,
	reportBootError,
} from "./lib/boot-errors";
import { electronQueryClient } from "./providers/ElectronTRPCProvider";

const rootElement = document.querySelector("app");
initBootErrorHandling(rootElement);

async function createDesktopRouter() {
	const [
		{ routeTree },
		{ persistentHistory },
		{ pruneExpiredTerminalState },
		{ sweepDeadPersistedKeys },
		{ NotFound },
	] = await Promise.all([
		import("./routeTree.gen"),
		import("./lib/persistent-hash-history"),
		import("./lib/terminal/terminal-buffer-gc"),
		import("./lib/persisted-keys"),
		import("./routes/not-found"),
	]);
	pruneExpiredTerminalState();
	sweepDeadPersistedKeys();
	persistentHistory.replace("/");
	return createRouter({
		routeTree,
		history: persistentHistory,
		defaultPreload: "intent",
		defaultNotFoundComponent: NotFound,
		context: { queryClient: electronQueryClient },
	});
}
declare module "@tanstack/react-router" {
	interface Register {
		router: Awaited<ReturnType<typeof createDesktopRouter>>;
	}
}

async function mountRenderer() {
	if (!window.ipcRenderer) {
		reportBootError(
			"Renderer preload not available (window.ipcRenderer missing)",
		);
		return;
	}
	if (!rootElement) {
		reportBootError("Missing <app> root element");
		return;
	}
	if (isBootErrorReported()) return;
	const root = ReactDom.createRoot(rootElement);
	if (new URLSearchParams(location.search).get("window") === "agent-island") {
		document.documentElement.dataset.window = "agent-island";
		document.documentElement.style.background = "transparent";
		document.body.style.background = "transparent";
		const [
			{ JedvAgentIsland },
			{ RendererLayout },
			{ ElectronTRPCProvider },
			{ LanguageAwareI18nProvider },
		] = await Promise.all([
			import("./components/JedvAgentIsland"),
			import("./components/RendererLayout"),
			import("./providers/ElectronTRPCProvider"),
			import("./components/LanguageAwareI18nProvider"),
		]);
		root.render(
			<RendererLayout>
				<ElectronTRPCProvider>
					<LanguageAwareI18nProvider>
						<JedvAgentIsland />
					</LanguageAwareI18nProvider>
				</ElectronTRPCProvider>
			</RendererLayout>,
		);
	} else root.render(<RendererRouter router={await createDesktopRouter()} />);
	markBootMounted();
}
if (import.meta.hot) import.meta.hot.dispose(cleanupBootErrorHandling);
void mountRenderer().catch((error) =>
	reportBootError("Renderer failed to load", error),
);
