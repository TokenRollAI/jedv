// A real PTY process with deterministic lifecycle and CLI behavior. No model,
// transcript from another session, or mocked host client is involved.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
/** @param {string} key */
function requiredEnv(key) {
	const value = process.env[key];
	if (!value) throw new Error(`Missing ${key}`);
	return value;
}
const logs = requiredEnv("JEDV_FIXTURE_LOG_DIR");
const terminal = requiredEnv("JEDV_TERMINAL_ID");
const session = randomUUID();
process.env.JEDV_AGENT_ID ||= "claude";
process.env.JEDV_AGENT_LAUNCH_ID ||= `fixture-${process.pid}-${randomUUID()}`;
/** @param {string} name @param {unknown} value */
const record = (name, value) =>
	writeFileSync(join(logs, `${terminal}.${name}.json`), JSON.stringify(value));
process.on("uncaughtException", (error) => {
	record("error", { error: error.message });
	process.exit(1);
});
/** @param {string[]} args */
const cli = async (args) => {
	const { stdout } = await run(
		requiredEnv("JEDV_FIXTURE_CLI"),
		[...args, "--json"],
		{ env: { ...process.env, CI: "1" }, maxBuffer: 2 * 1024 * 1024 },
	);
	return JSON.parse(stdout);
};
/** @param {string} event */
const hook = async (event) => {
	await run(
		"bash",
		[
			join(requiredEnv("JEDV_HOME_DIR"), "hooks/notify.sh"),
			JSON.stringify({ hook_event_name: event, session_id: session }),
		],
		{ env: process.env },
	);
};
const prompt = process.argv.at(-1) ?? "";
/** @param {string} name */
async function waitControl(name) {
	const path = join(logs, `${terminal}.${name}`);
	await new Promise((resolveReady) => {
		const finish = () => {
			if (existsSync(path)) {
				watcher.close();
				resolveReady(undefined);
			}
		};
		const watcher = watch(logs, finish);
		finish();
	});
}
if (prompt.trim().startsWith("prehook-start")) {
	process.stdout.write("PRE_HOOK_READY\n");
	record("pre-hook", { terminal, workspaceId: process.env.JEDV_WORKSPACE_ID });
	await waitControl("allow-cli");
	const sent = await cli([
		"mail",
		"send",
		"--to",
		"leader",
		"--body",
		"first turn before hook",
		"--dedupe-key",
		"prehook-cli",
	]);
	record("pre-hook-cli", sent);
	await waitControl("allow-hooks");
}
let handled = 0;
let busy = false;
await hook("SessionStart");
await hook("Start");
if (prompt === "leader") {
	const team = await cli([
		"team",
		"init",
		"--name",
		"PTY Team",
		"--goal",
		"isolated M1 validation",
	]);
	record("team", team);
} else if (process.env.JEDV_TEAM_ROLE === "worker") {
	await cli([
		"mail",
		"send",
		"--to",
		"leader",
		"--body",
		`ready:${process.env.JEDV_TEAM_MEMBER_NAME}`,
		"--dedupe-key",
		`startup:${process.env.JEDV_TEAM_MEMBER_ID}`,
	]);
}
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write("\x1b[?2004hFIXTURE_READY\n");
await hook("Stop");
record("ready", {
	prompt,
	terminal,
	workspaceId: process.env.JEDV_WORKSPACE_ID,
	memberId: process.env.JEDV_TEAM_MEMBER_ID,
	role: process.env.JEDV_TEAM_ROLE,
	cwd: process.cwd(),
	session,
});

/** @param {string} text */
async function handle(text) {
	if (text === "busy") {
		busy = true;
		await hook("Start");
		record("busy", { busy: true });
		return;
	}
	await hook("Start");
	if (text.includes("[Jedv Mail ")) {
		const inbox = await cli(["mail", "inbox"]);
		const deliveries = [];
		for (const item of inbox.items) {
			const read = await cli(["mail", "read", item.delivery.id]);
			if (read.delivery.ackedAt !== null)
				throw new Error("read implicitly acknowledged mail");
			if (item.event.type === "fixture.ping" && item.event.hopCount < 8) {
				const peer =
					item.event.sourceKind === "member"
						? item.event.sourceId
						: JSON.parse(item.event.payloadJson ?? "{}").peer;
				if (peer) {
					const response = await cli([
						"mail",
						"send",
						"--to",
						peer,
						"--reply-to",
						item.event.id,
						"--type",
						"fixture.ping",
						"--body",
						"ping-pong",
						"--dedupe-key",
						`reply:${item.event.id}`,
					]);
					record(`ping-hop-${response.event.hopCount}`, {
						eventId: response.event.id,
						hop: response.event.hopCount,
						deliveries: response.deliveries,
					});
				}
			}
			if (item.event.type === "fixture.independent")
				record("independent", { eventId: item.event.id });
			await cli(["mail", "ack", item.delivery.id]);
			deliveries.push(item.delivery.id);
		}
		handled++;
		record(`handled-${handled}`, { deliveries, text });
	}
	await hook("Stop");
}
const watcher = watch(logs, (_event, file) => {
	if (
		busy &&
		String(file) === `${terminal}.release` &&
		existsSync(join(logs, `${terminal}.release`))
	) {
		busy = false;
		void hook("Stop").then(() => record("released", { busy: false }));
	}
});
let buffer = "";
let chain = Promise.resolve();
process.stdin.on("data", (data) => {
	buffer += data.toString("utf8");
	let index = buffer.indexOf("\r");
	while (index !== -1) {
		const text = buffer
			.slice(0, index)
			.replaceAll("\x1b[200~", "")
			.replaceAll("\x1b[201~", "");
		buffer = buffer.slice(index + 1);
		index = buffer.indexOf("\r");
		chain = chain
			.then(() => handle(text))
			.catch((error) => record("error", { error: error.message }));
	}
});
process.stdin.on("end", () => {
	watcher.close();
	process.exit(0);
});
process.on("SIGHUP", () => process.exit(0));
