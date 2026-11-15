import { Trans, useLingui } from "@lingui/react/macro";
import { electronTrpcClient } from "renderer/lib/trpc-client";
import { AsyncSetting } from "../AsyncSetting";
import { FontSettingSection } from "../FontSettingSection";
import { LanguageSection } from "../LanguageSection/LanguageSection";
import { MarkdownStyleSection } from "../MarkdownStyleSection";
import { ThemeSection } from "../ThemeSection";
export function AppearanceSettings() {
	const { t } = useLingui();
	return (
		<div className="space-y-6">
			<div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
				<ThemeSection />
				<LanguageSection />
				<MarkdownStyleSection />
			</div>
			<FontSettingSection />
			<section className="space-y-3">
				<h3 className="text-sm font-medium">
					<Trans>Agent activity</Trans>
				</h3>
				<div className="rounded-lg border border-border overflow-hidden divide-y">
					<AsyncSetting
						id="island-enabled"
						label={t({ message: "Menu bar activity" })}
						description={t({
							message:
								"Open agent activity from the menu bar. The panel closes when it loses focus or when you press Escape.",
						})}
						read={async () =>
							(await electronTrpcClient.agentIsland.getState.query())
								.preferences.enabled
						}
						write={(enabled) =>
							electronTrpcClient.agentIsland.setEnabled.mutate({ enabled })
						}
					/>
				</div>
			</section>
		</div>
	);
}
