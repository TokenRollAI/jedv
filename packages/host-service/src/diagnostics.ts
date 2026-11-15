export function reportAttachmentResolveFailure(error: unknown): void {
	console.error("[host-service] attachment resolution failed", error);
}

export function reportUsageWorkerCrash(error: unknown): void {
	console.error("[host-service] usage worker crashed", error);
}
