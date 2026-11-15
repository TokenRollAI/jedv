import type { PluginManifestInput } from "./manifest-schema";

type PublishedPluginManifest = PluginManifestInput & {
	extensions: {
		jedv: {
			interface: { displayName: string; category?: string; icon?: string };
		};
	};
	skills: readonly { name: string; description: string }[];
};

export const FIRST_PARTY_MANIFESTS: Readonly<
	Record<string, PublishedPluginManifest>
> = {} as const;

export type FirstPartyPluginName = keyof typeof FIRST_PARTY_MANIFESTS;

export function firstPartyManifest(
	name: string,
): (typeof FIRST_PARTY_MANIFESTS)[FirstPartyPluginName] | null {
	if (!Object.hasOwn(FIRST_PARTY_MANIFESTS, name)) return null;
	return (FIRST_PARTY_MANIFESTS as Record<string, unknown>)[
		name
	] as (typeof FIRST_PARTY_MANIFESTS)[FirstPartyPluginName];
}
