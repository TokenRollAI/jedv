#!/usr/bin/env bash
#
# Smoke-tests a built CLI distribution using only an isolated temporary home.
# Usage: smoke-test.sh <dist-dir> <target>
#   <target> darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64
set -euo pipefail

DIST="$(cd "${1:?usage: smoke-test.sh <dist-dir> <target>}" && pwd)"
TARGET="${2:?usage: smoke-test.sh <dist-dir> <target>}"
echo "[smoke] dist=$DIST target=$TARGET"

test -f "$DIST/lib/host-service.js"
test -f "$DIST/lib/pty-daemon.js"
"$DIST/lib/node" --version

if [[ "$TARGET" == darwin-* ]]; then
	HELPER="$DIST/lib/node_modules/node-pty/prebuilds/darwin-${TARGET#darwin-}/spawn-helper"
	test -x "$HELPER" || { echo "[smoke] spawn-helper not executable: $HELPER" >&2; exit 1; }
fi

SMOKE_ROOT="$(mktemp -d /tmp/jedv-dist-smoke.XXXXXXXX)"
USER_HOME="$SMOKE_ROOT/home"
APP_HOME="$SMOKE_ROOT/app-home"
HOST_MANIFEST="$APP_HOME/host/jedv-local/manifest.json"
DAEMON_MANIFEST="$APP_HOME/host/jedv-local/pty-daemon-manifest.json"
HOST_PID=""
DAEMON_PID=""

run_cli() {
	env -i PATH="$PATH" HOME="$USER_HOME" SHELL=/bin/sh TMPDIR="$SMOKE_ROOT" \
		JEDV_HOME_DIR="$APP_HOME" \
		"$DIST/bin/jedv" "$@"
}

json_field() {
	"$DIST/lib/node" -e '
		const manifest = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
		process.stdout.write(String(manifest[process.argv[2]]));
	' "$1" "$2"
}

await_stopped() {
	local pid="$1"
	for ((i = 0; i < 50; i++)); do
		if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
		sleep 0.1
	done
	return 1
}

stop_owned_pid() {
	local pid="$1"
	[[ -n "$pid" ]] || return 0
	if kill -0 "$pid" 2>/dev/null; then
		kill "$pid" 2>/dev/null || true
		if ! await_stopped "$pid"; then
			kill -9 "$pid" 2>/dev/null || true
		fi
	fi
}

cleanup() {
	local status=$?
	if [[ -f "$HOST_MANIFEST" || -f "$DAEMON_MANIFEST" ]]; then
		run_cli stop --terminals >/dev/null 2>&1 || true
	fi
	stop_owned_pid "$HOST_PID"
	stop_owned_pid "$DAEMON_PID"
	rm -rf "$SMOKE_ROOT"
	return "$status"
}
trap cleanup EXIT

mkdir -p "$USER_HOME" "$APP_HOME"

run_cli --version
run_cli --help >/dev/null

# Native addons must load from the bundled tree, and node-pty must spawn a real PTY.
(
	cd "$SMOKE_ROOT"
	env -i PATH="$PATH" HOME="$USER_HOME" SHELL=/bin/sh TMPDIR="$SMOKE_ROOT" JEDV_HOME_DIR="$APP_HOME" \
		NODE_PATH="$DIST/lib/node_modules" "$DIST/lib/node" -e '
		for (const m of ["better-sqlite3", "node-pty", "@parcel/watcher"]) {
			require(m);
			console.log("[smoke]", m, "OK");
		}
	'
)
(
	cd "$SMOKE_ROOT"
	env -i PATH="$PATH" HOME="$USER_HOME" SHELL=/bin/sh TMPDIR="$SMOKE_ROOT" JEDV_HOME_DIR="$APP_HOME" \
		NODE_PATH="$DIST/lib/node_modules" DIST="$DIST" "$DIST/lib/node" -e '
		const resolved = require.resolve("node-pty/lib/unixTerminal");
		if (!resolved.startsWith(process.env.DIST)) {
			console.error("[smoke] node-pty leaked from non-bundled tree:", resolved);
			process.exit(1);
		}
		const pty = require("node-pty");
		const term = pty.spawn("/bin/sh", ["-c", "echo SPAWN_OK"], {
			name: "xterm", cols: 80, rows: 24,
			cwd: process.cwd(), env: process.env,
		});
		let got = "";
		let exited = null;
		const timeout = setTimeout(() => {
			term.kill();
			console.error("[smoke] pty spawn timeout");
			process.exit(1);
		}, 5000);
		term.onData((d) => { got += d.toString(); });
		term.onExit((e) => {
			exited = e;
			setTimeout(() => {
				clearTimeout(timeout);
				if (got.includes("SPAWN_OK") && exited.exitCode === 0) {
					console.log("[smoke] pty spawn OK");
					process.exit(0);
				}
				console.error("[smoke] pty spawn FAIL exit=" + exited.exitCode + " got=" + JSON.stringify(got));
				process.exit(1);
			}, 100);
		});
	'
)

# The real CLI creates the host, DB, manifest, PSK, and daemon under APP_HOME.
echo "[smoke] starting isolated local host"
run_cli start --daemon
test -f "$HOST_MANIFEST"
test -f "$APP_HOME/host/jedv-local/host.db"
HOST_PID="$(json_field "$HOST_MANIFEST" pid)"
HOST_SECRET="$(json_field "$HOST_MANIFEST" authToken)"
HOST_URL="$(json_field "$HOST_MANIFEST" endpoint)"
kill -0 "$HOST_PID"

healthy=0
for ((i = 0; i < 120; i++)); do
	if curl -fsS -m 2 "$HOST_URL/trpc/health.check" > "$SMOKE_ROOT/health.json" 2>/dev/null; then
		healthy=1
		break
	fi
	kill -0 "$HOST_PID" 2>/dev/null || break
	sleep 0.5
done
if [[ "$healthy" != 1 ]]; then
	echo "[smoke] FAIL — isolated host never became healthy" >&2
	cat "$APP_HOME/host/jedv-local/host-service.log" >&2 || true
	exit 1
fi
grep -q '"status":"ok"' "$SMOKE_ROOT/health.json"
echo "[smoke] real host health OK"

unauthorized_status="$(curl -sS -m 5 -o "$SMOKE_ROOT/unauthorized.json" -w '%{http_code}' \
	"$HOST_URL/chat-v3/trpc/listSessions?input=%7B%7D")"
if [[ "$unauthorized_status" != "401" ]]; then
	echo "[smoke] FAIL — protected query without PSK returned $unauthorized_status" >&2
	exit 1
fi
curl -fsS -m 10 -H "Authorization: Bearer $HOST_SECRET" \
	"$HOST_URL/chat-v3/trpc/listSessions?input=%7B%7D" >/dev/null
echo "[smoke] PSK protected query OK; unauthorized query rejected"

curl -fsS -m 5 -H "Authorization: Bearer $HOST_SECRET" \
	"$HOST_URL/trpc/terminalAgents.controlCapabilities" > "$SMOKE_ROOT/capabilities.json"
"$DIST/lib/node" -e '
	const raw = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
	const capabilities = raw.result.data.json ?? raw.result.data;
	const providers = capabilities.map((entry) => entry.provider).sort();
	if (JSON.stringify(providers) !== JSON.stringify(["agy", "claude", "codex", "kimi"])) process.exit(1);
' "$SMOKE_ROOT/capabilities.json"
echo "[smoke] native control API exposes the four providers"

env -i PATH="$PATH" HOME="$USER_HOME" HOST_URL="$HOST_URL" HOST_TOKEN="$HOST_SECRET" AUTOMATION_FILE="$APP_HOME/automations.json" \
	"$DIST/lib/node" --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
async function rpc(method, input, mutation = false) {
	const encoded = JSON.stringify({ json: input });
	const response = await fetch(`${process.env.HOST_URL}/trpc/${method}${mutation ? "" : `?input=${encodeURIComponent(encoded)}`}`, {
		method: mutation ? "POST" : "GET",
		headers: { Authorization: `Bearer ${process.env.HOST_TOKEN}`, "Content-Type": "application/json" },
		...(mutation ? { body: encoded } : {}),
		signal: AbortSignal.timeout(5000),
	});
	assert.equal(response.ok, true, `${method} failed with HTTP ${response.status}`);
	const payload = await response.json();
	assert.ok(payload.result, `${method} did not return a result`);
	return payload.result.data.json;
}
assert.deepEqual(await rpc("automations.list"), []);
const created = await rpc("automations.create", {
	name: "Isolated smoke", prompt: "Never run this fixture", agent: "codex",
	target: { kind: "workspace", workspaceId: randomUUID() }, enabled: false,
	rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0", timezone: "UTC",
}, true);
assert.equal(created.enabled, false);
assert.equal(created.nextRunAt, null);
const stored = JSON.parse(readFileSync(process.env.AUTOMATION_FILE, "utf8"));
assert.equal(stored.definitions.find((item) => item.id === created.id).enabled, false);
const updated = await rpc("automations.update", { id: created.id, patch: { name: "Updated smoke" } }, true);
assert.equal(updated.rrule, created.rrule);
assert.equal((await rpc("automations.get", { id: created.id })).name, "Updated smoke");
assert.deepEqual(await rpc("automations.listRuns", { automationId: created.id }), []);
await rpc("automations.remove", { id: created.id }, true);
assert.deepEqual(await rpc("automations.list"), []);
console.log("[smoke] real automation CRUD persisted without launching an agent");
NODE

for ((i = 0; i < 120; i++)); do
	[[ -f "$DAEMON_MANIFEST" ]] && break
	kill -0 "$HOST_PID" 2>/dev/null || break
	sleep 0.5
done
test -f "$DAEMON_MANIFEST"
DAEMON_PID="$(json_field "$DAEMON_MANIFEST" pid)"
kill -0 "$DAEMON_PID"
echo "[smoke] real terminal daemon running"

run_cli stop --terminals
await_stopped "$HOST_PID"
await_stopped "$DAEMON_PID"
test ! -e "$HOST_MANIFEST"
test ! -e "$DAEMON_MANIFEST"
HOST_PID=""
DAEMON_PID=""
echo "[smoke] isolated host and terminal daemon stopped"
echo "[smoke] all checks passed"
