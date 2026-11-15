import type { MemoryItemShape, MemoryScope } from "@jedv/shared/memory";
import type { LocalClient } from "../../local-client";
export type MemoryScopeOption = MemoryScope & { label: string };
export interface MemoryPanelProps {
	client: LocalClient;
	hostUrl: string;
	scopes: MemoryScopeOption[];
	readOnly?: boolean;
	disabled?: boolean;
}
export type MemoryItem = MemoryItemShape;
export const memoryKey = (hostUrl: string) =>
	["jedv", hostUrl, "memory"] as const;
export const scopeKey = (scope: MemoryScope) =>
	JSON.stringify([scope.scopeKind, scope.scopeId]);
