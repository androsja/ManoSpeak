---
description: Report the status of a deep work plan without executing (provided by the installed `deepworkplan` skill)
---

# /dwp-status — provided by the `deepworkplan` skill

> Thin alias. The flow lives in the installed `deepworkplan` skill — this file only routes to it, so there is a single source of truth and no drift.

## What to do

Route this invocation to the **status** sub-skill of the installed `deepworkplan` skill and follow it: read `/Users/jflorezgaleano/.gemini/skills/deepworkplan/status/SKILL.md` and execute its flow.

> Other agents: invoke the skill's `deepworkplan-status` sub-skill directly (`/deepworkplan-status` in Claude Code, `#deepworkplan-status` elsewhere). This `dwp-status` file is the shorter, conventional alias.
