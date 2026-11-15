import type { AutoUpdateStatusEvent } from "shared/auto-update";

export function updateDisplayState(event: AutoUpdateStatusEvent) {
	if (event.availability !== "supported") return "unavailable";
	if (event.installing) return "installing";
	if (event.status === "idle") {
		if (event.checkOutcome === "up-to-date") return "up-to-date";
		if (event.checkOutcome === "update-available") return "deferred";
		if (event.checkOutcome === "failed") return "error";
		return "not-checked";
	}
	return event.status;
}
