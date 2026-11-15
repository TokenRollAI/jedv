import { msg } from "@lingui/core/macro";
import type { LocalClient } from "../../local-client";
export type Automation = Awaited<
	ReturnType<LocalClient["automations"]["list"]["query"]>
>[number];
export type AutomationRun = Awaited<
	ReturnType<LocalClient["automations"]["listRuns"]["query"]>
>[number];
export type AutomationInput = Parameters<
	LocalClient["automations"]["create"]["mutate"]
>[0];
export const runLabels = {
	starting: msg({ message: "Starting" }),
	running: msg({ message: "Running" }),
	"awaiting-approval": msg({ message: "Awaiting approval" }),
	succeeded: msg({ message: "Turn completed" }),
	failed: msg({ message: "Failed" }),
	interrupted: msg({ message: "Interrupted" }),
};
export const runColors = {
	starting: "bg-blue-500",
	running: "bg-amber-500",
	"awaiting-approval": "bg-yellow-500",
	succeeded: "bg-emerald-500",
	failed: "bg-destructive",
	interrupted: "bg-muted-foreground",
};
