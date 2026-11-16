import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
	sourceLocale: "en",
	locales: [
		"en",
		"ja",
		"zh-CN",
		"fr",
		"ko",
		"zh-TW",
		"es",
		"de",
		"pt-BR",
		"it",
		"ru",
		"tr",
		"pl",
		"nl",
		"id",
		"cs",
		"vi",
		"uk",
	],
	// Origins follow filesystem order, which differs between macOS and Linux
	// and would dirty the CI diff.
	format: formatter({ origins: false }),
	orderBy: "message",
	compileNamespace: "ts",
	catalogs: [
		{
			path: "<rootDir>/locales/{locale}/messages",
			include: [
				"<rootDir>/../../apps/desktop/src",
				"<rootDir>/../../packages/ui/src",
				"<rootDir>/../../packages/panes/src",
				"<rootDir>/../../packages/chat-ui/src",
				"<rootDir>/../../packages/shared/src",
				"<rootDir>/../../packages/cli/src/commands/agents/launch-status/command.ts",
				"<rootDir>/../../packages/cli/src/commands/mail/send/command.ts",
				"<rootDir>/../../packages/host-service/src/mobile/assets/messages.ts",
				"<rootDir>/src",
			],
			exclude: [
				"<rootDir>/../../**/node_modules/**",
				"<rootDir>/../../**/*.test.*",
				"<rootDir>/../../**/*.stories.*",
			],
		},
	],
});
