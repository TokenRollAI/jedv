import { createContext } from "react";
import { electronTrpcClient } from "renderer/lib/trpc-client";
export const ButlerMarkdownContext = createContext<
	(url: string) => Promise<void>
>(async (url) => {
	await electronTrpcClient.external.openUrl.mutate(url);
});
