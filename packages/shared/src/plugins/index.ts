export * from "./bundled-manifests";

import type { OrganizationRole } from "../auth/roles/roles";
import { firstPartyManifest } from "./bundled-manifests";

export const DEFAULT_MARKETPLACE = "jedv";
export const DEFAULT_MARKETPLACE_REF = "main";

const ORGANIZATION_MARKETPLACE_PREFIX = "organization-";

/** Every organization has its own marketplace name, so two organizations' same-named plugins never share an install key. */
export function organizationMarketplace(organizationId: string): string {
	return `${ORGANIZATION_MARKETPLACE_PREFIX}${organizationId}`;
}

export function organizationIdOfMarketplace(
	marketplace: string,
): string | null {
	return isOrganizationMarketplace(marketplace)
		? marketplace.slice(ORGANIZATION_MARKETPLACE_PREFIX.length) || null
		: null;
}

/** Whether a plugin manifest names a connector or its own MCP server. */
export function manifestHasTools(manifest: unknown): boolean {
	const jedv = (
		manifest as {
			extensions?: {
				jedv?: { connector?: { slug?: unknown }; mcp?: { url?: unknown } };
			};
		}
	)?.extensions?.jedv;
	return (
		typeof jedv?.connector?.slug === "string" ||
		typeof jedv?.mcp?.url === "string"
	);
}

export function isOrganizationMarketplace(marketplace: string): boolean {
	return marketplace.startsWith(ORGANIZATION_MARKETPLACE_PREFIX);
}

export const ORGANIZATION_PLUGIN_ACCESS = [
	"unavailable",
	"available",
	"installed",
] as const;

export type OrganizationPluginAccess =
	(typeof ORGANIZATION_PLUGIN_ACCESS)[number];

export type OrganizationPluginPolicy = Partial<
	Record<OrganizationRole, OrganizationPluginAccess>
>;

/** A plugin a repository sync adds stays with the admins until one of them opens it to members. */
export const DEFAULT_ORGANIZATION_PLUGIN_POLICY: OrganizationPluginPolicy = {
	owner: "available",
	admin: "available",
};

export function organizationPluginAccess(
	policy: OrganizationPluginPolicy,
	role: string,
): OrganizationPluginAccess {
	return policy[role as OrganizationRole] ?? "unavailable";
}

export const JEDV_HOSTED_PLUGINS: readonly string[] = [];
export type JedvHostedPlugin = (typeof JEDV_HOSTED_PLUGINS)[number];

export function isJedvHosted(name: string): boolean {
	return (JEDV_HOSTED_PLUGINS as readonly string[]).includes(name);
}
/**
 * The curated plugin catalog the desktop Plugins page renders and installs
 * from. Static for the MVP — each entry is shaped as a pre-resolved plugin
 * manifest using the Codex plugin vocabulary
 * (developers.openai.com/plugins/build/plugins: `name`, `version`,
 * `description`, `interface`, and an `.mcp.json`-shaped `mcpServers` map), so
 * when the catalog grows real sources (git/npm/tarball) entries port
 * field-for-field instead of needing a data migration.
 *
 * Icons stay per-app (`packages/shared` isn't React-aware) — same split as
 * `INTEGRATIONS` in ../integrations.ts.
 */

/**
 * One MCP server a plugin materializes into agent configs. Same shape as a
 * Codex/Claude `.mcp.json` value: remote servers carry `url` (+ transport
 * `type`), local ones `command`/`args`/`env`. Server auth happens in the
 * agent CLI on first use (Codex calls this ON_FIRST_USE) — org
 * integration_connections tokens are a separate plane and never ship here.
 */
export type PluginMcpServerConfig =
	| {
			type: "http" | "sse";
			url: string;
			headers?: Record<string, string>;
			/**
			 * A command printing a JSON object of headers on stdout, run per
			 * connection without persisting credentials. Claude and pdev call it
			 * `headersHelper`; Codex calls it `http_headers_helper`.
			 */
			headersHelper?: string;
	  }
	| {
			command: string;
			args?: readonly string[];
			env?: Record<string, string>;
	  };

export const PLUGIN_CATEGORIES = [
	"Productivity",
	"Communication",
	"Developer tools",
	"Design",
	"Data & APIs",
] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

export interface PluginCatalogEntry {
	/**
	 * Stable kebab-case id — the key installs, the materialization ledger, and
	 * analytics all hang off. Where a `integration_provider` slug exists for
	 * the same product (linear, github, notion, sentry) the id matches it, so
	 * a future join against `integration_connections` is free.
	 */
	name: string;
	/** Semver; bumping forces re-materialization (Codex convention). */
	version: string;
	description: string;
	interface: {
		displayName: string;
		category: PluginCategory;
		/** A built-in icon key, or an image path inside the plugin (`./assets/icon.png`). */
		icon?: string;
	};
	/**
	 * Server-name → config. Names land verbatim as config keys in agent CLIs
	 * (`mcp__<name>__<tool>` namespacing comes from the CLI itself); ownership
	 * is tracked by the materialization ledger, not the name.
	 */
	mcpServers: Record<string, PluginMcpServerConfig>;
	/** Names of skills the plugin bundles (Codex manifests point `skills` at a directory; a resolved entry lists them). */
	skills?: readonly string[];
	auth?: readonly {
		type: "oauth2" | "api_key";
		label?: string | null;
		inputs?: readonly {
			name: string;
			label?: string;
			placeholder?: string;
			required?: boolean;
			secret?: boolean;
		}[];
	}[];
	/** Curation attribute, not manifest vocabulary: surfaces in Featured. */
	featured?: boolean;
}

/**
 * An MCP server found in the user's agent configs that Jedv didn't write
 * — any scope (Claude user/project, Codex, Cursor). Carries enough of the
 * config to match against catalog entries by more than name: people name
 * servers freely ("linear-server"), so identity comes from where the server
 * points, not what it's called.
 */
export interface ExternalMcpServer {
	name: string;
	url?: string;
	command?: string;
	args?: readonly string[];
	/** Where it was found, for display: "Claude Code (project)", "Codex", … */
	source?: string;
}

function urlHost(value: string): string | null {
	try {
		return new URL(value).hostname;
	} catch {
		return null;
	}
}

/**
 * "npx -y @playwright/mcp@latest" → "@playwright/mcp". Only the first
 * non-flag arg names the package — scanning further would match subcommands
 * (e.g. a literal `mcp` arg) and create false matches against unrelated
 * servers.
 */
function packageFromArgs(args: readonly string[] | undefined): string | null {
	for (const arg of args ?? []) {
		if (arg.startsWith("-")) continue;
		const match = arg.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@[^@]*)?$/);
		return match?.[1] ?? null;
	}
	return null;
}

function isPluginProxyUrl(value: string): boolean {
	try {
		return new URL(value).pathname.startsWith("/mcp/plugins/");
	} catch {
		return false;
	}
}

function sameEndpoint(a: string, b: string): boolean {
	try {
		const [x, y] = [new URL(a), new URL(b)];
		const path = (url: URL) => url.pathname.replace(/\/+$/, "");
		return x.host === y.host && path(x) === path(y) && x.search === y.search;
	} catch {
		return false;
	}
}

function externalMatchesConfig(
	server: ExternalMcpServer,
	catalogName: string,
	config: PluginMcpServerConfig,
): boolean {
	if (server.name === catalogName) return true;
	if ("url" in config && server.url) {
		if (isPluginProxyUrl(config.url)) {
			if (sameEndpoint(config.url, server.url)) return true;
		} else {
			const catalogHost = urlHost(config.url);
			if (catalogHost !== null && catalogHost === urlHost(server.url))
				return true;
		}
	}
	if ("command" in config) {
		const pkg = packageFromArgs(config.args);
		if (pkg !== null) {
			const haystack = [server.command ?? "", ...(server.args ?? [])].join(" ");
			if (haystack.includes(pkg)) return true;
		}
	}
	return false;
}

/**
 * Whether one catalog server is already covered by an entry the user wrote
 * themselves — matched by name, remote URL hostname (the full endpoint for a
 * plugin proxy URL, which all share one host), or the npm package a
 * stdio server runs (people name servers freely, e.g. "linear-server").
 * The materializer skips satisfied servers so installing never duplicates.
 */
export function isServerSatisfiedExternally(
	catalogName: string,
	config: PluginMcpServerConfig,
	external: readonly ExternalMcpServer[],
): boolean {
	return external.some((server) =>
		externalMatchesConfig(server, catalogName, config),
	);
}

/** What a plugin puts on your machine, for at-a-glance labeling in the UI. */
export type PluginComponentKind = "mcp" | "cli" | "skills";

/**
 * Derived from the manifest so labels can't drift from behavior: a remote
 * `url` server is "mcp", a `command` server runs a local process ("cli"),
 * bundled skills are "skills".
 */
export function getPluginComponentKinds(
	plugin: PluginCatalogEntry,
): PluginComponentKind[] {
	const kinds = new Set<PluginComponentKind>();
	for (const config of Object.values(plugin.mcpServers)) {
		kinds.add("url" in config ? "mcp" : "cli");
	}
	if (plugin.skills && plugin.skills.length > 0) {
		kinds.add("skills");
	}
	return [...kinds];
}

/**
 * The managed skills the `jedv` plugin provisions into every agent CLI
 * (see packages/agent-setup/src/managed-skills.ts). The Plugins page lists
 * these read-only on its Skills tab; they are not installable units in the
 * MVP.
 */
export const JEDV_MANAGED_SKILLS: readonly {
	name: string;
	description: string;
}[] = [];

export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = [];

export function pluginProxyMcpServers(
	_name: string,
	_marketplace: string = DEFAULT_MARKETPLACE,
	_options: { headersHelper?: string } = {},
): Record<string, PluginMcpServerConfig> | undefined {
	return undefined;
}

export function desiredPluginMcpServers(
	_installed: readonly {
		name: string;
		marketplace?: string;
		enabled?: boolean;
		tools?: boolean;
	}[],
	_options: { headersHelper?: string } = {},
): Record<string, PluginMcpServerConfig> {
	return {};
}

export function pluginConnectorSlug(name: string): string | undefined {
	const extension = firstPartyManifest(name)?.extensions?.jedv as
		| { connector?: { slug: string } }
		| undefined;
	return extension?.connector?.slug;
}

export function getPluginByName(name: string): PluginCatalogEntry | undefined {
	const entry = PLUGIN_CATALOG.find((plugin) => plugin.name === name);
	if (!entry) return undefined;
	const proxied = pluginProxyMcpServers(name);
	return proxied ? { ...entry, mcpServers: proxied } : entry;
}

/**
 * The desktop's old install record in local-db settings. Nothing writes it
 * now. The desktop reads it at each boot only to copy entries it has not seen
 * into installed_plugins.json; the column stays so a build from before the
 * move can still open the database.
 */
export interface InstalledPlugin {
	name: string;
	version: string;
	installedAt: string;
	/**
	 * false = keep the install record but materialize nothing (Codex's
	 * `enabled = false` semantics). Absent means enabled — records written
	 * before this field existed stay active.
	 */
	enabled?: boolean;
}
