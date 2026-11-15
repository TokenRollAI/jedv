import { router } from "../trpc/index";
import { aiSettingsRouter } from "../trpc/router/ai-settings";
import { memoryRouter } from "../trpc/router/memory";
import { watchdogRouter } from "../trpc/router/watchdog";
export const memoryApiRouter = router({
	memory: memoryRouter,
	aiSettings: aiSettingsRouter,
	watchdog: watchdogRouter,
});
export type MemoryApiRouter = typeof memoryApiRouter;
