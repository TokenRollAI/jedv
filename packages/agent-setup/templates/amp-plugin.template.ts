{{MARKER}}
// @i-know-the-amp-plugin-api-is-wip-and-very-experimental-right-now

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

declare const process: {
	env?: Record<string, string | undefined>;
	stderr?: { write: (message: string) => void };
};

type AmpEventName = "session.start" | "agent.start" | "agent.end";
type AmpApi = {
	on: (
		eventName: AmpEventName,
		handler: (event?: unknown) => unknown | Promise<unknown>,
	) => void;
};
type JedvGlobal = typeof globalThis & {
	__jedvAmpLifecyclePluginV1?: boolean;
};

function getStringProperty(
	value: Record<string, unknown>,
	keys: string[],
): string | undefined {
	for (const key of keys) {
		const property = value[key];
		if (typeof property === "string" && property.length > 0) {
			return property;
		}
	}
}

function getSessionId(event: unknown): string | undefined {
	if (!event || typeof event !== "object") return undefined;
	const record = event as Record<string, unknown>;
	const direct = getStringProperty(record, [
		"threadID",
		"threadId",
		"sessionID",
		"sessionId",
		"id",
	]);
	if (direct) return direct;

	const thread = record.thread;
	if (thread && typeof thread === "object") {
		return getStringProperty(thread as Record<string, unknown>, [
			"id",
			"threadID",
			"threadId",
		]);
	}
}

function isDebugEnabled(): boolean {
	const env = typeof process === "undefined" ? {} : process.env ?? {};
	return ["JEDV_DEBUG_HOOKS", "JEDV_DEBUG"].some((key) => {
		const value = env[key];
		return value === "1" || value === "true" || value === "TRUE";
	});
}

function debugLog(message: string): void {
	if (!isDebugEnabled()) return;
	process?.stderr?.write?.("[jedv-amp-plugin] " + message + "\n");
}

export default function jedvAmpLifecyclePlugin(amp: AmpApi) {
	const jedvGlobal = globalThis as JedvGlobal;
	if (jedvGlobal.__jedvAmpLifecyclePluginV1) return;
	jedvGlobal.__jedvAmpLifecyclePluginV1 = true;

	const env = typeof process === "undefined" ? {} : process.env ?? {};
	if (!env.JEDV_TERMINAL_ID && !env.JEDV_TAB_ID) {
		debugLog("disabled: missing Jedv terminal env");
		return;
	}

	const jedvHome = env.JEDV_HOME_DIR || join(homedir(), "{{APP_HOME_DIR_NAME}}");
	const notifyPath = join(jedvHome, "hooks", "notify.sh");
	if (!existsSync(notifyPath)) {
		debugLog("disabled: notify hook missing at " + notifyPath);
		return;
	}

	debugLog(
		"enabled terminalId=" +
			(env.JEDV_TERMINAL_ID || "") +
			" tabId=" +
			(env.JEDV_TAB_ID || "") +
			" notify=" +
			notifyPath,
	);

  // Reserve before any await/queue/spawn. The allocation-only child does
  // bounded local filesystem work; the event callback never waits for HTTP.
  const reserveSequence = () => {
    const reservation = {
      JEDV_HOOK_SEQUENCE_ALLOCATED: "1",
      JEDV_HOOK_DELIVERY_SEQUENCE: "",
    };
    if (!env.JEDV_AGENT_LAUNCH_ID || !env.JEDV_HOME_DIR) return reservation;
    try {
      const result = spawnSync("bash", [notifyPath, "--allocate-delivery-sequence"], {
        env: env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500,
      });
      const sequence = result.status === 0 ? result.stdout.trim() : "";
      if (/^[1-9][0-9]{0,14}$/.test(sequence))
        reservation.JEDV_HOOK_DELIVERY_SEQUENCE = sequence;
    } catch { /* Reservation failures stay display-only. */ }
    return reservation;
  };
	const notify = (hookEventName: string, event?: unknown) => {
		const reservation = reserveSequence();
		const sessionId = getSessionId(event);
		const payload = JSON.stringify({
			hook_event_name: hookEventName,
			resourceId: sessionId,
			session_id: sessionId,
		});

		try {
			const child = spawn(notifyPath, [], {
				stdio: ["pipe", "ignore", "ignore"],
				detached: true,
				env: { ...env, ...reservation, JEDV_HOOK_HARNESS: "amp" },
			});
			child.on("error", (error) => {
				debugLog("spawn failed event=" + hookEventName + " error=" + error.message);
			});
			child.stdin?.on("error", (error) => {
				debugLog("stdin failed event=" + hookEventName + " error=" + error.message);
			});
			child.stdin?.end(payload);
			child.unref();
			debugLog(
				"spawned event=" +
					hookEventName +
					" sessionId=" +
					(sessionId || "") +
					" terminalId=" +
					(env.JEDV_TERMINAL_ID || ""),
			);
		} catch (error) {
			// Best effort only. Jedv notifications must never interrupt Amp.
			debugLog(
				"spawn threw event=" +
					hookEventName +
					" error=" +
					(error instanceof Error ? error.message : String(error)),
			);
		}
	};

	amp.on("session.start", async (event) => {
		notify("SessionStart", event);
	});
	amp.on("agent.start", async (event) => {
		notify("Start", event);
	});
	amp.on("agent.end", async (event) => {
		notify("Stop", event);
	});
}
