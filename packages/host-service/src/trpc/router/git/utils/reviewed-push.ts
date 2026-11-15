import { createHash } from "node:crypto";
import type { SimpleGit } from "simple-git";

export type PushPreview =
	| {
			status: "ready";
			sourceBranch: string;
			targetBranch: string;
			remote: string;
			remoteUrl: string;
			head: string;
			confirmationToken: string;
			setUpstream: boolean;
			mode: "default" | "linked-pr" | "publish";
	  }
	| {
			status: "unsupported";
			reason: string;
			sourceBranch: string | null;
			head: string | null;
	  };

export interface ReviewedPushContext {
	workspaceId: string;
	worktreePath: string;
	linkedPrHeadBranch: string | null;
}

type PushPlan = {
	preview: PushPreview;
	url?: string;
	config?: string;
	trackingRef?: string;
};

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readConfig(raw: string): Map<string, string[]> {
	const config = new Map<string, string[]>();
	for (const entry of raw.split("\0")) {
		if (!entry) continue;
		const separator = entry.indexOf("\n");
		const key = separator < 0 ? entry : entry.slice(0, separator);
		const value = separator < 0 ? "" : entry.slice(separator + 1);
		config.set(key, [...(config.get(key) ?? []), value]);
	}
	return config;
}

export function redactPushUrl(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.username = "";
		parsed.password = "";
		parsed.search = "";
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return url.replace(/^[^/@\s]+@(?=[^/]*:)/, "").split(/[?#]/)[0] ?? "";
	}
}

function supportedUrl(url: string): boolean {
	if (!url || url.startsWith("-") || /[\r\n\0]/.test(url) || url.includes("::"))
		return false;
	return !url.includes("://") || /^(https?|ssh|git|file):\/\//.test(url);
}

export async function readIndexConflicts(git: SimpleGit): Promise<string[]> {
	const entries = await git.raw(["ls-files", "--unmerged", "-z"]);
	return [
		...new Set(
			entries.split("\0").flatMap((entry) => {
				const tab = entry.indexOf("\t");
				return tab < 0 ? [] : [entry.slice(tab + 1)];
			}),
		),
	].sort();
}

export async function getReviewedPushPlan(
	git: SimpleGit,
	context: ReviewedPushContext,
): Promise<PushPlan> {
	const branchRef = (
		await git.raw(["symbolic-ref", "--quiet", "HEAD"]).catch(() => "")
	).trim();
	const sourceBranch = branchRef.startsWith("refs/heads/")
		? branchRef.slice(11)
		: null;
	const head =
		(
			await git.revparse(["--verify", "HEAD^{commit}"]).catch(() => "")
		).trim() || null;
	const unsupported = (reason: string): PushPlan => ({
		preview: { status: "unsupported", reason, sourceBranch, head },
	});
	if (!sourceBranch) return unsupported("detached-head");
	if (!head) return unsupported("unborn-head");
	if ((await readIndexConflicts(git)).length)
		return unsupported("unresolved-conflicts");

	const configRaw = await git.raw(["config", "--null", "--list"]);
	const config = readConfig(configRaw);
	const all = (key: string) => config.get(key) ?? [];
	const last = (key: string) => all(key).at(-1);
	const configuredRemote = last(`branch.${sourceBranch}.remote`);
	const upstreamRef = (
		await git.raw(["rev-parse", "--abbrev-ref", "@{upstream}"]).catch(() => "")
	).trim();
	const hasRemoteUpstream =
		!!upstreamRef && !!configuredRemote && configuredRemote !== ".";
	const upstreamBranch = !hasRemoteUpstream
		? null
		: upstreamRef.startsWith(`${configuredRemote}/`)
			? upstreamRef.slice(configuredRemote.length + 1)
			: upstreamRef.split("/").slice(1).join("/");
	const remotes = (await git.getRemotes(false)).map(({ name }) => name);
	const fallbackRemote = remotes.includes("origin") ? "origin" : remotes[0];
	let remote: string | undefined;
	let targetBranch = sourceBranch;
	let mode: "default" | "linked-pr" | "publish";
	if (hasRemoteUpstream && upstreamBranch === sourceBranch) {
		mode = "default";
		remote =
			last(`branch.${sourceBranch}.pushremote`) ??
			last("remote.pushdefault") ??
			configuredRemote;
		const pushDefault = last("push.default") ?? "simple";
		if (!["simple", "current", "upstream", "tracking"].includes(pushDefault))
			return unsupported(`push-default-${pushDefault}`);
		if (
			(pushDefault === "upstream" || pushDefault === "tracking") &&
			remote !== configuredRemote
		)
			return unsupported("upstream-remote-mismatch");
		if (all(`branch.${sourceBranch}.merge`).length !== 1)
			return unsupported("ambiguous-upstream");
	} else {
		remote = hasRemoteUpstream ? configuredRemote : fallbackRemote;
		if (
			hasRemoteUpstream &&
			upstreamBranch &&
			context.linkedPrHeadBranch === upstreamBranch
		) {
			mode = "linked-pr";
			targetBranch = upstreamBranch;
		} else {
			mode = "publish";
		}
	}
	if (!remote) return unsupported("no-remote");
	if (remote === "." || remote.startsWith("-") || !remotes.includes(remote))
		return unsupported("unsupported-remote");
	if (all(`remote.${remote}.push`).length)
		return unsupported("custom-push-refspec");
	const fetchRefspecs = all(`remote.${remote}.fetch`);
	if (
		fetchRefspecs.some(
			(refspec) => refspec !== `+refs/heads/*:refs/remotes/${remote}/*`,
		)
	)
		return unsupported("custom-fetch-refspec");
	const disabled = (key: string) =>
		last(key) == null || /^(false|no|off|0)$/i.test(last(key) ?? "");
	if (!disabled(`remote.${remote}.mirror`)) return unsupported("mirror");
	if (!disabled("push.followtags")) return unsupported("follow-tags");
	if (!disabled("push.recursesubmodules"))
		return unsupported("recurse-submodules");
	if (last(`remote.${remote}.receivepack`))
		return unsupported("custom-receive-pack");
	if (last(`remote.${remote}.vcs`)) return unsupported("remote-helper");
	if (all(`branch.${sourceBranch}.merge`).length > 1)
		return unsupported("ambiguous-upstream");
	try {
		await git.raw(["check-ref-format", `refs/heads/${targetBranch}`]);
	} catch {
		return unsupported("invalid-target-branch");
	}
	const urls = (await git.raw(["remote", "get-url", "--push", "--all", remote]))
		.replace(/\n$/, "")
		.split("\n");
	if (urls.length !== 1) return unsupported("multiple-push-urls");
	const url = urls[0];
	if (!url || !supportedUrl(url)) return unsupported("unsupported-push-url");
	// Git applies URL rewrites again when an expanded URL is passed to push.
	for (const [key, prefixes] of config) {
		if (
			/^url\..*\.(insteadof|pushinsteadof)$/.test(key) &&
			prefixes.some((prefix) => url.startsWith(prefix))
		)
			return unsupported("cascading-url-rewrite");
	}
	const plan = {
		sourceBranch,
		targetBranch,
		remote,
		head,
		setUpstream: mode === "publish",
		mode,
	};
	return {
		preview: {
			status: "ready",
			...plan,
			remoteUrl: redactPushUrl(url),
			confirmationToken: hash({ context, plan, url, configRaw, upstreamRef }),
		},
		url,
		config: configRaw,
		trackingRef: fetchRefspecs.length
			? `refs/remotes/${remote}/${targetBranch}`
			: undefined,
	};
}

export type ReviewedPushResult =
	| { ok: true }
	| {
			ok: false;
			reason: "changed" | "rejected" | "failed" | "upstream-failed";
	  };

export async function executeReviewedPush(
	git: SimpleGit,
	context: ReviewedPushContext,
	confirmationToken: string,
): Promise<ReviewedPushResult> {
	const plan = await getReviewedPushPlan(git, context);
	if (plan.preview.status !== "ready") return { ok: false, reason: "changed" };
	if (plan.preview.confirmationToken !== confirmationToken || !plan.url)
		return { ok: false, reason: "changed" };
	const preview = plan.preview;
	try {
		await git.raw([
			"push",
			"--porcelain",
			"--no-force",
			"--no-mirror",
			"--no-follow-tags",
			"--recurse-submodules=no",
			"--",
			plan.url,
			`${preview.head}:refs/heads/${preview.targetBranch}`,
		]);
	} catch (error) {
		return {
			ok: false,
			reason: /non-fast-forward|fetch first|rejected/i.test(String(error))
				? "rejected"
				: "failed",
		};
	}
	try {
		if (plan.trackingRef) {
			await git.raw([
				"update-ref",
				"--no-deref",
				plan.trackingRef,
				preview.head,
			]);
		}
		if (preview.setUpstream) {
			const currentConfig = await git.raw(["config", "--null", "--list"]);
			if (currentConfig !== plan.config)
				return { ok: false, reason: "upstream-failed" };
			await git.raw([
				"config",
				`branch.${preview.sourceBranch}.remote`,
				preview.remote,
			]);
			await git.raw([
				"config",
				`branch.${preview.sourceBranch}.merge`,
				`refs/heads/${preview.targetBranch}`,
			]);
		}
	} catch {
		return { ok: false, reason: "upstream-failed" };
	}
	return { ok: true };
}
