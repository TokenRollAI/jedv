import { i18n, initI18n } from "@jedv/i18n";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { RendererErrorBoundary } from "../RendererErrorBoundary";

if (!i18n.locale) initI18n();

export function RendererLayout({ children }: { children: ReactNode }) {
	return (
		<RendererErrorBoundary>
			<I18nProvider i18n={i18n}>{children}</I18nProvider>
		</RendererErrorBoundary>
	);
}
