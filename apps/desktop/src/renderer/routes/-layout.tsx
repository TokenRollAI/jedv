import { Outlet } from "@tanstack/react-router";
import { ContentBoundary } from "renderer/components/ContentBoundary";
import { LanguageAwareI18nProvider } from "renderer/components/LanguageAwareI18nProvider";
import { ElectronTRPCProvider } from "renderer/providers/ElectronTRPCProvider";

export function RootLayout() {
	return (
		<ElectronTRPCProvider>
			<LanguageAwareI18nProvider>
				<ContentBoundary>
					<Outlet />
				</ContentBoundary>
			</LanguageAwareI18nProvider>
		</ElectronTRPCProvider>
	);
}
