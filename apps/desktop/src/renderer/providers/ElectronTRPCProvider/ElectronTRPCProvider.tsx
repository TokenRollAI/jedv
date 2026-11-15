import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { electronReactClient } from "renderer/lib/trpc-client";

export const electronQueryClient = new QueryClient({
	defaultOptions: {
		queries: { networkMode: "always", retry: false },
		mutations: { networkMode: "always", retry: false },
	},
});

export function ElectronTRPCProvider({ children }: { children: ReactNode }) {
	return (
		<electronTrpc.Provider
			client={electronReactClient}
			queryClient={electronQueryClient}
		>
			<QueryClientProvider client={electronQueryClient}>
				{children}
			</QueryClientProvider>
		</electronTrpc.Provider>
	);
}
