# Herdr DWP agent monitor

The `com.vozual.herdr-dwp-monitor` LaunchAgent runs every 30 seconds for workspace `wC` and this repository. It first asks the DWP queue helper to dispatch explicitly prepared `queued` work units to matching idle agents, then lists Herdr agents and filters by the exact repository root/workspace. It notifies on newly available agents and repeats an idle reminder every two minutes while agents remain available, including a clear warning when no ready queue item exists. It compares `completion_seq` as well as pane status, so a task that starts and finishes between 30-second polls still creates a moderator wake event. When the primary moderator pane `wC:p6` becomes idle, the monitor submits one Herdr prompt asking it to review completed reports and queue only distinct, executable follow-up work; it does not send repeated prompts for the same completion. It remembers available panes, pending moderator wakes, and reminder time under `~/Library/Application Support/VozualAgentMonitor/`. The helper never invents task prompts or changes formal DWP task status; the moderator must verify evidence and prepare a distinct queue item. Pane `wC:p6` is excluded from technical dispatch; the ticket-status moderator pane `wC:pE` remains eligible when explicitly assigned.

An agent becoming idle means its assigned work unit finished; it does not mean the agent crashed. The queue helper moves that assignment to `needs_review` and deliberately waits for a moderator to review the result before preparing follow-up work. The service cannot dispatch work when the queue contains no `queued` item. Persistent reminders make that state visible, but do not replace the review/queue decision or guarantee that finite work never runs out.

The monitor sends a Herdr notification when an unassigned agent changes to `idle` or `done`. Agents from other repositories/workspaces are excluded. The primary moderator pane `wC:p6` is excluded; the ticket-status moderator `wC:pE` can receive an explicit DWP work unit. The service dispatches only when a reviewed queue entry is already marked `queued`; it does not invent work prompts, and the moderator still reviews every result and controls formal DWP status.

## Install and control

The repository files are `scripts/launchd/monitor_vozual_agents.sh` and `scripts/launchd/com.vozual.herdr-dwp-monitor.plist`. The installed script and plist are copied to `~/Library/Application Support/VozualAgentMonitor/monitor_vozual_agents.sh` and `~/Library/LaunchAgents/com.vozual.herdr-dwp-monitor.plist`.

```sh
mkdir -p "$HOME/Library/Application Support/VozualAgentMonitor" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/Vozual"
install -m 755 scripts/launchd/monitor_vozual_agents.sh "$HOME/Library/Application Support/VozualAgentMonitor/monitor_vozual_agents.sh"
install -m 644 scripts/launchd/com.vozual.herdr-dwp-monitor.plist "$HOME/Library/LaunchAgents/com.vozual.herdr-dwp-monitor.plist"
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.vozual.herdr-dwp-monitor.plist
launchctl print gui/$(id -u)/com.vozual.herdr-dwp-monitor
launchctl kickstart -k gui/$(id -u)/com.vozual.herdr-dwp-monitor
```

Stop and remove the scheduled job with:

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.vozual.herdr-dwp-monitor.plist
```

Logs are written to `~/Library/Logs/Vozual/herdr-dwp-monitor.out.log` and `herdr-dwp-monitor.err.log`. The LaunchAgent runs while the user's macOS GUI session is logged in and the machine is awake. It does not send a message into a ChatGPT conversation; the user sees a Herdr desktop notification and can then ask the moderator to review/reassign.

The DWP queue remains local under the Gitignored `.dwp/` directory. The monitor does not transfer queue state to other agents or machines.
