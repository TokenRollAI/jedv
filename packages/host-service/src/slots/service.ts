import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	type InstalledSlot,
	type SlotView,
	slotManifestSchema,
} from "@jedv/shared/declarative-slots";
import { z } from "zod";
import { problem, readPrivateJson, writePrivateJson } from "../peers/security";
import type { PeerService } from "../peers/service";

const installedSchema = z
	.array(
		z
			.object({
				manifest: slotManifestSchema,
				enabled: z.boolean(),
				teamId: z.string().nullable(),
				installedAt: z.number(),
			})
			.strict(),
	)
	.max(100)
	.refine(
		(x) => new Set(x.map((e) => e.manifest.id)).size === x.length,
		"Duplicate extension IDs",
	);
export class DeclarativeSlotService {
	private readonly path: string;
	private mutations: Promise<unknown> = Promise.resolve();
	private mutate<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.mutations.then(operation);
		this.mutations = next.catch(() => {});
		return next;
	}
	constructor(
		readonly peers: PeerService,
		home: string,
	) {
		this.path = join(home, "extensions/declarative-slots.json");
		peers.extensionEnabled = (id) => this.enabled(id);
		peers.extensionAllows = (id, type) => {
			try {
				const entry = this.list().find(
					(x) => x.enabled && x.manifest.id === id,
				);
				return !!entry?.manifest.slots.some(
					(s) =>
						s.target === "mail.provider" &&
						type === `provider.${id}.${s.eventTypeSuffix}`,
				);
			} catch {
				return false;
			}
		};
	}
	list(): InstalledSlot[] {
		return installedSchema.parse(readPrivateJson(this.path) ?? []);
	}
	private write(all: InstalledSlot[]) {
		return writePrivateJson(this.path, installedSchema.parse(all));
	}
	enabled(id: string): boolean {
		try {
			return this.list().some((x) => x.enabled && x.manifest.id === id);
		} catch {
			return false;
		}
	}
	install(input: { manifestPath: string; bindTeamId?: string }) {
		return this.mutate(() => this.installNow(input));
	}
	private async installNow(input: {
		manifestPath: string;
		bindTeamId?: string;
	}) {
		const stat = statSync(input.manifestPath);
		if (!stat.isFile() || stat.size > 65_536)
			problem("BAD_REQUEST", "Manifest must be a JSON file under 64KiB");
		const manifest = slotManifestSchema.parse(
			JSON.parse(readFileSync(input.manifestPath, "utf8")),
		);
		if (
			manifest.slots.some((s) => s.target === "mail.provider") &&
			!input.bindTeamId
		)
			problem("BAD_REQUEST", "Provider extension requires a target Team");
		const all = this.list();
		if (all.some((x) => x.manifest.id === manifest.id))
			problem("CONFLICT", "Extension is already installed");
		if (input.bindTeamId)
			this.peers.mail.team.resolve({ teamId: input.bindTeamId });
		const extension: InstalledSlot = {
			manifest,
			enabled: true,
			teamId: input.bindTeamId ?? null,
			installedAt: this.peers.now(),
		};
		await this.write([...all, extension]);
		try {
			return { extension, ...this.issue(extension) };
		} catch (error) {
			this.peers.revokeExtension(manifest.id);
			await this.write(all);
			throw error;
		}
	}
	private issue(extension: InstalledSlot) {
		const provider = extension.manifest.slots.find(
			(s) => s.target === "mail.provider",
		);
		if (!provider) return {};
		return {
			providerToken: this.peers.createProviderToken(
				{
					name: extension.manifest.name,
					teamId:
						extension.teamId ??
						problem("PRECONDITION_FAILED", "Provider is not bound to a Team"),
					allowedTo: provider.allowedTo,
					typePrefix: `provider.${extension.manifest.id}.`,
				},
				extension.manifest.id,
			),
		};
	}
	setEnabled(input: { extensionId: string; enabled: boolean }) {
		return this.mutate(() => this.setEnabledNow(input));
	}
	private async setEnabledNow(input: {
		extensionId: string;
		enabled: boolean;
	}) {
		const all = this.list(),
			extension =
				all.find((x) => x.manifest.id === input.extensionId) ??
				problem("NOT_FOUND", "Extension not found");
		if (extension.enabled === input.enabled) return { extension };
		this.peers.revokeExtension(input.extensionId);
		extension.enabled = input.enabled;
		await this.write(all);
		if (!input.enabled) return { extension };
		try {
			return { extension, ...this.issue(extension) };
		} catch (error) {
			extension.enabled = false;
			await this.write(all);
			throw error;
		}
	}
	uninstall(input: { extensionId: string }) {
		return this.mutate(() => this.uninstallNow(input));
	}
	private async uninstallNow(input: { extensionId: string }) {
		// Revoke before removing the file entry; a disk failure must not keep an old token valid.
		this.peers.revokeExtension(input.extensionId);
		await this.write(
			this.list().filter((x) => x.manifest.id !== input.extensionId),
		);
		return { removed: true as const };
	}
	resolveView(input: {
		surface: "teamwork.header" | "sidebar.panel";
		teamId?: string;
	}): SlotView[] {
		return this.list()
			.filter((x) => x.enabled && (!x.teamId || x.teamId === input.teamId))
			.flatMap((extension) => {
				let payload: Record<string, unknown> = {};
				if (extension.teamId) {
					const row = this.peers.db
						.prepare(
							"SELECT e.payload_json FROM mail_events e JOIN mail_provider_tokens p ON e.source_id=p.id WHERE e.source_kind='provider' AND p.extension_id=? AND e.team_id=? AND p.revoked_at IS NULL ORDER BY e.created_at DESC,e.rowid DESC LIMIT 1",
						)
						.get(extension.manifest.id, extension.teamId) as
						| { payload_json: string | null }
						| undefined;
					if (row?.payload_json) {
						try {
							const value: unknown = JSON.parse(row.payload_json);
							if (value && typeof value === "object" && !Array.isArray(value))
								payload = value as Record<string, unknown>;
						} catch {}
					}
				}
				return extension.manifest.slots.flatMap((slot) => {
					if (slot.target !== input.surface) return [];
					const items = slot.items.map((field) => {
						const value = field.payloadKey
							? Object.hasOwn(payload, field.payloadKey)
								? payload[field.payloadKey]
								: undefined
							: field.text;
						return {
							label: field.label,
							text: (["string", "number", "boolean"].includes(typeof value)
								? String(value)
								: ""
							).slice(0, 240),
						};
					});
					return [
						{
							extensionId: extension.manifest.id,
							name: extension.manifest.name,
							target: slot.target,
							items,
							...(slot.target === "sidebar.panel"
								? {
										cardType: slot.cardType,
										title: slot.title,
										...(slot.url ? { url: slot.url } : {}),
									}
								: {}),
						},
					];
				});
			});
	}
}
