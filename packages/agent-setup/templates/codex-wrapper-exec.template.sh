# The wrapper uses Codex's process-scoped TUI session log for Start/permission
# events. Avoid tailing global rollout files: concurrent Codex sessions share
# that directory.
_jedv_debug_enabled="0"
case "$JEDV_DEBUG_HOOKS" in
  1|true|TRUE|True|yes|YES|on|ON) _jedv_debug_enabled="1" ;;
esac
if [ "$_jedv_debug_enabled" != "1" ] && { [ "$JEDV_ENV" = "development" ] || [ "$NODE_ENV" = "development" ]; }; then
  _jedv_debug_enabled="1"
fi

_jedv_notify_path="{{NOTIFY_PATH}}"
_jedv_debug_log="${JEDV_HOOK_DEBUG_LOG:-/tmp/jedv-codex-hooks.log}"
_jedv_has_jedv_context="0"
[ -n "$JEDV_TERMINAL_ID$JEDV_TAB_ID$JEDV_PANE_ID" ] && _jedv_has_jedv_context="1"
JEDV_CODEX_SESSION_WATCHER_PID=""
_jedv_codex_args=()

_jedv_debug() {
  [ "$_jedv_debug_enabled" = "1" ] || return 0
  printf '%s [codex-wrapper] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date)" "$*" >> "$_jedv_debug_log" 2>/dev/null || true
}

_jedv_toml_escape() {
  local _jedv_value="$1"
  _jedv_value="${_jedv_value//\\/\\\\}"
  _jedv_value="${_jedv_value//\"/\\\"}"
  printf '%s' "$_jedv_value"
}

_jedv_configure_project_trust() {
  [ -n "${JEDV_WORKSPACE_PATH:-}" ] || return 0

  local _jedv_workspace_codex_home="$JEDV_WORKSPACE_PATH/.codex"
  [ -f "$_jedv_workspace_codex_home/config.toml" ] || return 0

  local _jedv_workspace_path_toml
  _jedv_workspace_path_toml="$(_jedv_toml_escape "$JEDV_WORKSPACE_PATH")"
  _jedv_codex_args+=("-c" "projects={\"$_jedv_workspace_path_toml\"={trust_level=\"trusted\"}}")
  _jedv_debug "using trusted workspace Codex project config path=$JEDV_WORKSPACE_PATH"
}

_jedv_configure_project_trust

_jedv_child_pids_for() {
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -P "$1" 2>/dev/null || true
    return 0
  fi
  ps -axo pid=,ppid= 2>/dev/null | awk -v ppid="$1" '$2 == ppid { print $1 }' 2>/dev/null || true
}

_jedv_cleanup_session_watcher() {
  if [ -n "$JEDV_CODEX_SESSION_WATCHER_PID" ]; then
    _jedv_watcher_pid="$JEDV_CODEX_SESSION_WATCHER_PID"
    _jedv_child_pids="$(_jedv_child_pids_for "$_jedv_watcher_pid" | tr '\n' ' ')"
    for _jedv_child_pid in $_jedv_child_pids; do
      kill -TERM "$_jedv_child_pid" >/dev/null 2>&1 || true
    done
    kill -TERM "$_jedv_watcher_pid" >/dev/null 2>&1 || true
    sleep 0.2
    _jedv_child_pids="$_jedv_child_pids $(_jedv_child_pids_for "$_jedv_watcher_pid" | tr '\n' ' ')"
    for _jedv_child_pid in $_jedv_child_pids; do
      kill -KILL "$_jedv_child_pid" >/dev/null 2>&1 || true
    done
    kill -KILL "$_jedv_watcher_pid" >/dev/null 2>&1 || true
    _jedv_debug "session watcher cleanup signaled pid=$_jedv_watcher_pid"
    JEDV_CODEX_SESSION_WATCHER_PID=""
  fi
}

_jedv_exit_trap() {
  _jedv_status=$?
  trap - EXIT HUP INT TERM
  _jedv_cleanup_session_watcher
  exit "$_jedv_status"
}

trap _jedv_exit_trap EXIT HUP INT TERM

if [ "$_jedv_has_jedv_context" = "1" ] && [ -f "$_jedv_notify_path" ]; then
  export CODEX_TUI_RECORD_SESSION="${CODEX_TUI_RECORD_SESSION:-1}"
  export CODEX_TUI_SESSION_LOG_PATH="${TMPDIR:-/tmp}/jedv-codex-session-$$_$(date +%s).jsonl"
  _jedv_debug "session watcher starting terminalId=$JEDV_TERMINAL_ID tabId=$JEDV_TAB_ID paneId=$JEDV_PANE_ID log=$CODEX_TUI_SESSION_LOG_PATH notify=$_jedv_notify_path"

  (
    _jedv_notify="$_jedv_notify_path"
    _jedv_session_log="$CODEX_TUI_SESSION_LOG_PATH"

    _jedv_emit_event() {
      _jedv_payload=$(printf '{"hook_event_name":"%s"}' "$1")
      _jedv_debug "emitting $1 via $_jedv_notify"
      bash "$_jedv_notify" "$_jedv_payload" >/dev/null 2>&1 || true
    }

    _jedv_i=0
    while [ ! -f "$_jedv_session_log" ] && [ "$_jedv_i" -lt 200 ]; do
      _jedv_i=$((_jedv_i + 1))
      sleep 0.1
    done
    if [ ! -f "$_jedv_session_log" ]; then
      _jedv_debug "session log not found path=$_jedv_session_log"
      exit 0
    fi
    _jedv_debug "watching session=$_jedv_session_log"

    tail -n +1 -F "$_jedv_session_log" 2>/dev/null | while IFS= read -r _jedv_line; do
      case "$_jedv_line" in
        *'"dir":"from_tui"'*'"kind":"op"'*'"UserTurn"'*) _jedv_emit_event "Start" ;;
        *'_approval_request"'*) _jedv_emit_event "PermissionRequest" ;;
      esac
    done
  ) 2>/dev/null &
  JEDV_CODEX_SESSION_WATCHER_PID=$!
  _jedv_debug "session watcher pid=$JEDV_CODEX_SESSION_WATCHER_PID"
else
  _jedv_notify_exists="0"
  [ -f "$_jedv_notify_path" ] && _jedv_notify_exists="1"
  _jedv_debug "session watcher disabled hasJedvContext=$_jedv_has_jedv_context terminalId=$JEDV_TERMINAL_ID tabId=$JEDV_TAB_ID paneId=$JEDV_PANE_ID notifyExists=$_jedv_notify_exists notify=$_jedv_notify_path"
fi

# Native hooks separate the main Stop event from SubagentStop. Do not inject
# Codex's legacy notify callback: it reports both as agent-turn-complete without
# parent metadata, so Jedv cannot filter subagent completions.
#
# Codex gates each hooks.json entry behind per-hook trust, and an untrusted
# hook is silently skipped — losing the Stop hook, Jedv's only completion
# signal for Codex, while the session watcher above still reports Start. The
# builtin launch commands pass the bypass themselves; append it for every
# other launch (manual `codex`, stale host agent configs, custom presets)
# unless the caller already did — codex rejects the flag when repeated. Hooks
# the user explicitly disabled stay disabled; the bypass only skips the trust
# gate.
_jedv_bypass_hook_trust="--dangerously-bypass-hook-trust"
for _jedv_arg in "$@"; do
  # Tokens past `--` are prompt text, never flags — stop scanning there so a
  # prompt that mentions the flag doesn't suppress the real one.
  [ "$_jedv_arg" = "--" ] && break
  if [ "$_jedv_arg" = "--dangerously-bypass-hook-trust" ]; then
    _jedv_bypass_hook_trust=""
    break
  fi
done
"$REAL_BIN" "${_jedv_codex_args[@]}" --enable hooks ${_jedv_bypass_hook_trust:+"$_jedv_bypass_hook_trust"} "$@"
JEDV_CODEX_STATUS=$?
_jedv_debug "codex exited status=$JEDV_CODEX_STATUS"

_jedv_cleanup_session_watcher

# Current Codex releases have a native SessionEnd hook. Keep this wrapper
# report as a compatibility fallback for older releases that do not: v2
# binding teardown is idempotent, so a duplicate from a current release is
# harmless. Only report a normal exit (status < 128); a signal death (SIGHUP
# from a killed pty/daemon) must stay unreported so the session remains a
# resume candidate. The signal traps above bypass this line entirely.
if [ "$_jedv_has_jedv_context" = "1" ] && [ -f "$_jedv_notify_path" ] && [ "$JEDV_CODEX_STATUS" -lt 128 ]; then
  _jedv_debug "emitting SessionEnd status=$JEDV_CODEX_STATUS"
  bash "$_jedv_notify_path" '{"hook_event_name":"SessionEnd"}' >/dev/null 2>&1 || true
fi

trap - EXIT HUP INT TERM
exit "$JEDV_CODEX_STATUS"
