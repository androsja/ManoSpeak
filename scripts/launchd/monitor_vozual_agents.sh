#!/bin/sh
set -eu
umask 077

HERDR_ENV=1
HERDR_SOCKET_PATH=/Users/jflorezgaleano/.config/herdr/herdr.sock
HERDR_BIN=/Users/jflorezgaleano/.local/bin/herdr
JQ_BIN=/usr/bin/jq
PYTHON_BIN=/opt/homebrew/bin/python3
REPO_ROOT=/Users/jflorezgaleano/Documents/JulianFlorez/Vozual
WORKSPACE_ID=wC
EXCLUDED_PANE=wC:p6
STATE_DIR="$HOME/Library/Application Support/VozualAgentMonitor"
STATE_FILE="$STATE_DIR/available-agents.json"
WAKE_PENDING_FILE="$STATE_DIR/moderator-wake-pending"
REMINDER_FILE="$STATE_DIR/last-idle-reminder.epoch"
REMINDER_INTERVAL_SECONDS=120
DWP_HELPER="$REPO_ROOT/.agents/skills/herdr-dwp-agent-monitor/scripts/monitor_dwp_agents.py"
DWP_PLAN="$REPO_ROOT/.dwp/plans/PLAN_lsc_motion_dsl_v4/state.json"
MODERATOR_PANE=wC:p6

export HERDR_ENV HERDR_SOCKET_PATH
mkdir -p "$STATE_DIR"

# Dispatch only work units explicitly prepared in the DWP queue. The helper
# never invents prompts or changes formal DWP task status.
dispatch_output=''
if ! dispatch_output=$("$PYTHON_BIN" "$DWP_HELPER" dispatch \
  --plan "$DWP_PLAN" --workspace-id "$WORKSPACE_ID" --no-notify 2>&1); then
  dispatch_output='queue dispatch failed; see stderr log'
fi
dispatch_summary=$(printf '%s\n' "$dispatch_output" | /usr/bin/awk '/^Dispatched:/ {line=$0} END {if (line != "") print line; else print "Dispatched: none"}')

agent_json=$("$HERDR_BIN" agent list)
current=$(printf '%s' "$agent_json" | "$JQ_BIN" -ce \
  --arg repo "$REPO_ROOT" \
  --arg workspace "$WORKSPACE_ID" \
  --arg excluded "$EXCLUDED_PANE" \
  '[.result.agents[]? | select(.cwd == $repo and .workspace_id == $workspace and .pane_id != $excluded and (.agent_status == "idle" or .agent_status == "done")) | {pane_id, agent, status: .agent_status, title: .terminal_title_stripped, completion_seq: (.completion_seq // 0)}] | sort_by(.pane_id)')

previous='[]'
if [ -f "$STATE_FILE" ]; then
  previous=$(cat "$STATE_FILE")
  printf '%s' "$previous" | "$JQ_BIN" -e 'type == "array"' >/dev/null
fi

newly_available=$("$JQ_BIN" -cn \
  --argjson current "$current" \
  --argjson previous "$previous" \
  '[$current[] as $agent | select(([$previous[].pane_id] | index($agent.pane_id)) == null) | $agent]')

newly_completed=$("$JQ_BIN" -cn \
  --argjson current "$current" \
  --argjson previous "$previous" \
  '[$current[] as $agent | ($previous | map(select(.pane_id == $agent.pane_id)) | first // {}) as $old | select(($agent.completion_seq // 0) > ($old.completion_seq // 0)) | $agent]')

wake_pending=0
if [ -f "$WAKE_PENDING_FILE" ]; then
  wake_pending=$(cat "$WAKE_PENDING_FILE")
  case "$wake_pending" in 1) ;; *) wake_pending=0 ;; esac
fi
current_count=$(printf '%s' "$current" | "$JQ_BIN" 'length')
moderator_wake=0
if [ "$current_count" -eq 0 ]; then
  wake_pending=0
elif [ "$newly_available" != '[]' ] || [ "$newly_completed" != '[]' ]; then
  wake_pending=1
fi

moderator_status=$(printf '%s' "$agent_json" | "$JQ_BIN" -r --arg pane "$MODERATOR_PANE" --arg workspace "$WORKSPACE_ID" --arg repo "$REPO_ROOT" '[.result.agents[]? | select(.pane_id == $pane and .workspace_id == $workspace and .cwd == $repo) | .agent_status][0] // "unknown"')
if [ "$wake_pending" -eq 1 ] && { [ "$moderator_status" = 'idle' ] || [ "$moderator_status" = 'done' ]; }; then
  idle_panes=$(printf '%s' "$current" | "$JQ_BIN" -r '[.[].pane_id] | join(", ")')
  moderator_prompt="Herdr monitor: Vozual DWP agents are idle: $idle_panes. Review completed queue work units and verify their reports/hashes. Assign only distinct, executable follow-up work; leave human-dependent items blocked and do not invent approvals. Do not change formal DWP task statuses or start Task 4 unless the Task 3 gate passes."
  if "$HERDR_BIN" agent prompt "$MODERATOR_PANE" "$moderator_prompt" >/dev/null 2>&1; then
    wake_pending=0
    moderator_wake=1
  fi
fi
temporary_wake="$WAKE_PENDING_FILE.tmp.$$"
printf '%s\n' "$wake_pending" > "$temporary_wake"
mv "$temporary_wake" "$WAKE_PENDING_FILE"

notification_due=0
now_epoch=$(date '+%s')
if [ "$(printf '%s' "$current" | "$JQ_BIN" 'length')" -gt 0 ]; then
  last_reminder=0
  if [ -f "$REMINDER_FILE" ]; then
    last_reminder=$(cat "$REMINDER_FILE")
    case "$last_reminder" in
      ''|*[!0-9]*) last_reminder=0 ;;
    esac
  fi
  if [ "$newly_available" != '[]' ] || [ $((now_epoch - last_reminder)) -ge "$REMINDER_INTERVAL_SECONDS" ]; then
    notification_due=1
  fi
else
  rm -f "$REMINDER_FILE"
fi

if [ "$notification_due" -eq 1 ]; then
  body=$(printf '%s' "$current" | "$JQ_BIN" -r '[.[] | "\(.pane_id) (\(.agent)): \(.title)"] | join("\n")')
  if [ "$dispatch_summary" = 'Dispatched: none' ]; then
    title='Vozual DWP: agents idle, queue empty'
    body=$(printf '%s\n%s' "$body" 'No ready work unit is queued. Moderator review/queueing is needed before another assignment.')
  else
    title='Vozual DWP: agents available'
  fi
  "$HERDR_BIN" notification show "$title" --body "$body" --sound done
  temporary_reminder="$REMINDER_FILE.tmp.$$"
  printf '%s\n' "$now_epoch" > "$temporary_reminder"
  mv "$temporary_reminder" "$REMINDER_FILE"
fi

temporary="$STATE_FILE.tmp.$$"
printf '%s\n' "$current" > "$temporary"
mv "$temporary" "$STATE_FILE"
printf '%s scanned workspace=%s available=%s new=%s completed=%s reminder=%s moderator_wake=%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$WORKSPACE_ID" "$current_count" "$(printf '%s' "$newly_available" | "$JQ_BIN" 'length')" "$(printf '%s' "$newly_completed" | "$JQ_BIN" 'length')" "$notification_due" "$moderator_wake" "$dispatch_summary"
