import { describe, expect, it } from "bun:test";
import {
	checkAccessibility,
	PERMISSION_SETTINGS_URLS,
	requestAccessibility,
	requestAppleEvents,
	requestFullDiskAccess,
	requestLocalNetwork,
} from "./native-permissions";

function createShellRecorder() {
	const openedUrls: string[] = [];

	return {
		openedUrls,
		shellApi: {
			openExternal: async (url: string) => {
				openedUrls.push(url);
			},
		},
	};
}

describe("native permissions", () => {
	it("checks Accessibility with the native trusted-client API", () => {
		expect(
			checkAccessibility({
				systemPreferencesApi: {
					isTrustedAccessibilityClient: (prompt) => prompt === false,
				},
			}),
		).toBe(true);
	});

	it("opens Full Disk Access settings", async () => {
		const { openedUrls, shellApi } = createShellRecorder();

		await requestFullDiskAccess({ shellApi });

		expect(openedUrls).toEqual([PERMISSION_SETTINGS_URLS.fullDiskAccess]);
	});

	it("opens Accessibility settings", async () => {
		const { openedUrls, shellApi } = createShellRecorder();

		await requestAccessibility({ shellApi });

		expect(openedUrls).toEqual([PERMISSION_SETTINGS_URLS.accessibility]);
	});

	it("opens Automation settings", async () => {
		const { openedUrls, shellApi } = createShellRecorder();

		await requestAppleEvents({ shellApi });

		expect(openedUrls).toEqual([PERMISSION_SETTINGS_URLS.appleEvents]);
	});

	it("opens Local Network settings", async () => {
		const { openedUrls, shellApi } = createShellRecorder();

		await requestLocalNetwork({ shellApi });

		expect(openedUrls).toEqual([PERMISSION_SETTINGS_URLS.localNetwork]);
	});
});
