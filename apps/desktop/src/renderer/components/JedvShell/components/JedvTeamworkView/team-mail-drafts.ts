export interface TeamMailDraftScope {
	hostId: string;
	teamId: string;
}
interface MailRequest {
	to: string;
	body: string;
	key: string;
}
interface MailDraft {
	to: string;
	body: string;
	request: MailRequest | null;
	pending: boolean;
}
const empty: MailDraft = {
	to: "leader",
	body: "",
	request: null,
	pending: false,
};
export const TEAM_MAIL_DRAFT_LIMIT = 32;
export const TEAM_MAIL_DRAFT_TTL = 24 * 60 * 60_000;
export const teamMailDraftKey = ({ hostId, teamId }: TeamMailDraftScope) =>
	JSON.stringify([hostId, teamId]);

// Renderer memory only: Host endpoint/provider remounts must not own retry identity.
export class TeamMailDraftStore {
	private readonly entries = new Map<
		string,
		{ scope: TeamMailDraftScope; value: MailDraft; updatedAt: number }
	>();
	private readonly listeners = new Set<() => void>();
	constructor(
		private readonly now = Date.now,
		private readonly uuid = () => crypto.randomUUID(),
	) {}
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	private notify() {
		for (const listener of this.listeners) listener();
	}
	read(scope: TeamMailDraftScope): MailDraft {
		const entry = this.entries.get(teamMailDraftKey(scope));
		return entry &&
			(entry.value.pending ||
				this.now() - entry.updatedAt < TEAM_MAIL_DRAFT_TTL)
			? entry.value
			: empty;
	}
	sweep() {
		let changed = false;
		for (const [key, entry] of this.entries)
			if (
				!entry.value.pending &&
				this.now() - entry.updatedAt >= TEAM_MAIL_DRAFT_TTL
			) {
				this.entries.delete(key);
				changed = true;
			}
		if (changed) this.notify();
	}
	private write(scope: TeamMailDraftScope, value: MailDraft) {
		this.sweep();
		const key = teamMailDraftKey(scope);
		if (!this.entries.has(key) && this.entries.size >= TEAM_MAIL_DRAFT_LIMIT) {
			const clean = [...this.entries].find(
				([, entry]) =>
					!entry.value.body && !entry.value.request && !entry.value.pending,
			);
			if (!clean) return false;
			this.entries.delete(clean[0]);
		}
		this.entries.set(key, { scope, value, updatedAt: this.now() });
		this.notify();
		return true;
	}
	edit(
		scope: TeamMailDraftScope,
		patch: Partial<Pick<MailDraft, "to" | "body">>,
	) {
		const previous = this.read(scope);
		if (previous.pending) return false;
		const value = {
			...previous,
			...patch,
			body: (patch.body ?? previous.body).slice(0, 200_000),
		};
		if (value.to !== previous.to || value.body !== previous.body)
			value.request = null;
		return this.write(scope, value);
	}
	begin(scope: TeamMailDraftScope): MailRequest | null {
		const previous = this.read(scope);
		if (previous.pending || !previous.body.trim()) return null;
		const request = previous.request ?? {
			to: previous.to,
			body: previous.body,
			key: this.uuid(),
		};
		return this.write(scope, { ...previous, request, pending: true })
			? request
			: null;
	}
	settle(scope: TeamMailDraftScope, request: MailRequest, succeeded: boolean) {
		const previous = this.read(scope);
		if (previous.request !== request) return;
		this.write(scope, {
			...previous,
			pending: false,
			...(succeeded ? { body: "", request: null } : {}),
		});
	}
	reconcile(hostId: string, liveTeamIds: ReadonlySet<string>) {
		let changed = false;
		for (const [key, entry] of this.entries)
			if (
				entry.scope.hostId === hostId &&
				!liveTeamIds.has(entry.scope.teamId)
			) {
				this.entries.delete(key);
				changed = true;
			}
		if (changed) this.notify();
	}
	clear() {
		this.entries.clear();
		this.notify();
	}
	get size() {
		return this.entries.size;
	}
}

export const teamMailDrafts = new TeamMailDraftStore();
