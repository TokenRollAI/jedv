#!/bin/bash
{{MARKER}}
# Gemini CLI lifecycle hook. JSON in via stdin; MUST print valid JSON to
# stdout before exit so gemini doesn't block on the hook.

INPUT=$(cat)

EVENT_TYPE=$(printf '%s' "$INPUT" | grep -oE '"hook_event_name"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"')
HOOK_SESSION_ID=$(printf '%s' "$INPUT" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -oE '"[^"]*"$' | tr -d '"')

case "$EVENT_TYPE" in
  BeforeAgent)              EVENT_TYPE="Start" ;;
  AfterAgent)               EVENT_TYPE="Stop"  ;;
  AfterTool)                EVENT_TYPE="Start" ;;
  SessionStart|SessionEnd)  ;;
  *)
    printf '{}\n'
    exit 0
    ;;
esac

printf '{}\n'

# ~/.gemini/settings.json is global, so this also fires in sessions launched
# outside Jedv terminals; only those terminals set JEDV_* vars.
[ -n "$JEDV_TERMINAL_ID" ] || [ -n "$JEDV_TAB_ID" ] || exit 0

# The wrapper's identity, or gemini when launched without one. Another
# agent's identity means gemini is running under it (a tool call), which is
# not this terminal's lifecycle.
AGENT_ID="${JEDV_AGENT_ID:-gemini}"
[ "$AGENT_ID" = "gemini" ] || exit 0

V1_EVENT_TYPE="$EVENT_TYPE"
case "$V1_EVENT_TYPE" in
  SessionStart) V1_EVENT_TYPE="Start" ;;
  SessionEnd)   V1_EVENT_TYPE="Stop" ;;
esac

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

# Resolve the host-service endpoint at call time: the env URL is frozen at
# terminal creation and goes stale when the host-service restarts on a new
# port, while each org manifest is rewritten with the live endpoint on every
# start. Only the host that owns this terminal answers "ignored":false.
if [ -n "$JEDV_TERMINAL_ID" ]; then
  PAYLOAD="{\"json\":{\"terminalId\":\"$(json_escape "$JEDV_TERMINAL_ID")\",\"eventType\":\"$(json_escape "$EVENT_TYPE")\",\"agent\":{\"agentId\":\"$(json_escape "$AGENT_ID")\",\"sessionId\":\"$(json_escape "$HOOK_SESSION_ID")\"}}}"

  HOOK_CANDIDATE_URLS="$JEDV_HOST_AGENT_HOOK_URL"
  for MANIFEST_FILE in "${JEDV_HOME_DIR:-$HOME/{{APP_HOME_DIR_NAME}}}"/host/*/manifest.json; do
    [ -f "$MANIFEST_FILE" ] || continue
    MANIFEST_ENDPOINT=$(grep -oE '"endpoint"[[:space:]]*:[[:space:]]*"[^"]*"' "$MANIFEST_FILE" | head -1 | grep -oE '"[^"]*"$' | tr -d '"')
    [ -n "$MANIFEST_ENDPOINT" ] || continue
    HOOK_CANDIDATE_URLS="$HOOK_CANDIDATE_URLS $MANIFEST_ENDPOINT/trpc/notifications.hook"
  done

  HOOK_DELIVERED_2XX="0"
  SEEN_HOOK_URLS=""
  for HOOK_URL in $HOOK_CANDIDATE_URLS; do
    case " $SEEN_HOOK_URLS " in *" $HOOK_URL "*) continue ;; esac
    SEEN_HOOK_URLS="$SEEN_HOOK_URLS $HOOK_URL"

    RESPONSE=$(curl -sX POST "$HOOK_URL" \
      --connect-timeout 2 --max-time 5 \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      -w "|%{http_code}" 2>/dev/null)
    STATUS_CODE="${RESPONSE##*|}"
    BODY="${RESPONSE%|*}"

    case "$BODY" in
      *'"ignored":false'*|*'"ignored": false'*) exit 0 ;;
    esac
    case "$STATUS_CODE" in
      2*) HOOK_DELIVERED_2XX="1" ;;
      *) echo "[gemini-hook] host-service dispatch failed status=$STATUS_CODE url=$HOOK_URL" >&2 ;;
    esac
  done

  [ "$HOOK_DELIVERED_2XX" = "1" ] && exit 0
  echo "[gemini-hook] no host-service accepted the event; falling back to v1" >&2
fi

[ -z "$JEDV_TAB_ID" ] && [ -z "$JEDV_TERMINAL_ID" ] && exit 0

curl -sG "http://127.0.0.1:${JEDV_PORT:-{{DEFAULT_PORT}}}/hook/complete" \
  --connect-timeout 1 --max-time 2 \
  --data-urlencode "paneId=$JEDV_PANE_ID" \
  --data-urlencode "tabId=$JEDV_TAB_ID" \
  --data-urlencode "workspaceId=$JEDV_WORKSPACE_ID" \
  --data-urlencode "terminalId=$JEDV_TERMINAL_ID" \
  --data-urlencode "sessionId=$HOOK_SESSION_ID" \
  --data-urlencode "hookSessionId=$HOOK_SESSION_ID" \
  --data-urlencode "eventType=$V1_EVENT_TYPE" \
  --data-urlencode "rawEventType=$EVENT_TYPE" \
  --data-urlencode "agentId=$AGENT_ID" \
  --data-urlencode "env=$JEDV_ENV" \
  --data-urlencode "version=$JEDV_HOOK_VERSION" \
  > /dev/null 2>&1

exit 0
