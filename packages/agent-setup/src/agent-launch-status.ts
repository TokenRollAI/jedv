import {
	closeSync,
	constants,
	fstatSync,
	openSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import { MANAGED_NOTIFY_RELATIVE_PATH } from "./agent-wrappers-common";
import { resolveAppHomeDir } from "./paths";

export interface AgentLaunchEvidence {
	runId: string;
	launchId: string;
	exitCode?: number;
}

function evidencePath(terminalId: string): string | null {
	if (!/^[a-zA-Z0-9._-]+$/.test(terminalId)) return null;
	return join(
		resolveAppHomeDir(),
		"state/agent-launches",
		`${terminalId}.json`,
	);
}

/** Local wrapper evidence, never readiness or automatic-input authority. */
export function readAgentLaunchEvidence(
	terminalId: string,
	runId: string,
): AgentLaunchEvidence | null {
	const path = evidencePath(terminalId);
	if (!path) return null;
	let fd: number | undefined;
	try {
		fd = openSync(
			path,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > 1024) return null;
		const data = JSON.parse(readFileSync(fd, "utf8"));
		if (
			data.runId !== runId ||
			typeof data.launchId !== "string" ||
			!data.launchId ||
			(data.exitCode !== undefined &&
				(!Number.isInteger(data.exitCode) ||
					data.exitCode < 0 ||
					data.exitCode > 255))
		)
			return null;
		return {
			runId,
			launchId: data.launchId,
			...(data.exitCode === undefined ? {} : { exitCode: data.exitCode }),
		};
	} catch {
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

export function removeAgentLaunchEvidence(terminalId: string): void {
	const path = evidencePath(terminalId);
	if (path) {
		try {
			rmSync(path, { force: true });
		} catch {
			/* Best-effort disposal cleanup. */
		}
	}
}

/** One atomic evidence file per terminal, removed when that terminal is disposed. */
export function buildAgentLaunchEvidenceExec(missingBinary = false): string {
	return `
_jedv_launch_id="\${JEDV_AGENT_LAUNCH_ID:-$$-$(date +%s)}"
_jedv_run_id="$JEDV_AGENT_RUN_ID"
unset JEDV_AGENT_RUN_ID
_jedv_evidence=""
case "$JEDV_TERMINAL_ID.$_jedv_run_id.$_jedv_launch_id" in
  *[!a-zA-Z0-9._-]*) ;;
  *)
    if [ -n "$JEDV_TERMINAL_ID" ] && [ -n "$_jedv_run_id" ] && [ -n "$_jedv_launch_id" ] && [ -n "$JEDV_HOME_DIR" ]; then
      _jedv_evidence="$JEDV_HOME_DIR/state/agent-launches/$JEDV_TERMINAL_ID.json"
    fi ;;
esac
_jedv_write_evidence() (
  [ -n "$_jedv_evidence" ] || exit 0
  umask 077
  mkdir -p "$JEDV_HOME_DIR/state/agent-launches" || exit 0
  _jedv_tmp="$_jedv_evidence.$$"
  printf '{"runId":"%s","launchId":"%s"%s}\\n' "$_jedv_run_id" "$_jedv_launch_id" "$1" > "$_jedv_tmp" && mv -f "$_jedv_tmp" "$_jedv_evidence"
  rm -f "$_jedv_tmp"
)
# Keep untracked/nested invocations' original exec and signal behavior.
if [ -z "$_jedv_evidence" ]; then ${missingBinary ? "exit 127" : 'exec "$REAL_BIN" "$@"'}; fi
_jedv_write_evidence ""
${missingBinary ? "(exit 127)" : '"$REAL_BIN" "$@"'}
_jedv_exit_code=$?
_jedv_write_evidence ",\\"exitCode\\":$_jedv_exit_code"
if [ -n "$JEDV_TERMINAL_ID" ] && [ -n "$JEDV_HOME_DIR" ] && [ -x "$JEDV_HOME_DIR/${MANAGED_NOTIFY_RELATIVE_PATH}" ]; then
  "$JEDV_HOME_DIR/${MANAGED_NOTIFY_RELATIVE_PATH}" '{"hook_event_name":"Stop"}' >/dev/null 2>&1 || true
  if [ -z "$JEDV_KIMI_CHAIN_CONTINUE" ] && [ "$_jedv_exit_code" -lt 128 ]; then
    "$JEDV_HOME_DIR/${MANAGED_NOTIFY_RELATIVE_PATH}" '{"hook_event_name":"SessionEnd"}' >/dev/null 2>&1 || true
  fi
fi
exit "$_jedv_exit_code"
`;
}
