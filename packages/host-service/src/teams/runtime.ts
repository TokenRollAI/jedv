import { resolveAppHomeDir } from "@jedv/agent-setup";
import { getHostId } from "@jedv/shared/host-info";
import { TRPCError } from "@trpc/server";
import { type MailDependencies, MailService } from "../mail/service";
import {
	OutboxForwarder,
	type PeerRuntimeTestHooks,
} from "../peers/outbox-forwarder";
import { PeerService } from "../peers/service";
import type { HostServiceContext } from "../types";
import { TeamService, type TeamServiceDependencies } from "./service";

export class TeamworkRuntime {
	readonly team: TeamService;
	readonly mail: MailService;
	readonly ready: Promise<void>;
	readonly peers: PeerService;
	readonly outbox: OutboxForwarder;
	constructor(
		ctx: HostServiceContext,
		deps: {
			team?: TeamServiceDependencies;
			mail?: MailDependencies;
			peers?: PeerRuntimeTestHooks & {
				home?: string;
				isManagementToken?: (raw: string) => boolean | Promise<boolean>;
			};
		} = {},
	) {
		this.team = new TeamService(ctx, {
			now: deps.peers?.clock?.now,
			...deps.team,
		});
		this.mail = new MailService(this.team, deps.mail);
		this.peers = new PeerService(this.mail, {
			home: deps.peers?.home ?? resolveAppHomeDir(),
			localHostId: deps.peers?.localHostId ?? getHostId(),
			now: deps.peers?.clock?.now,
			isManagementToken: deps.peers?.isManagementToken,
		});
		this.mail.peers = this.peers;
		this.outbox = new OutboxForwarder(this.peers, deps.peers);
		this.ready = this.team.recover().then(() => {
			this.mail.start();
			void this.outbox
				.start()
				.catch((error) => console.error("[peers] outbox stopped", error));
		});
	}
	async dispose() {
		await this.outbox.dispose();
		this.team.dispose();
		await this.mail.dispose();
	}
}

export async function requireTeamwork(ctx: HostServiceContext) {
	const runtime = ctx.runtime?.teamwork;
	if (!runtime)
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Teamwork is unavailable on this host",
		});
	await runtime.ready;
	return runtime;
}
