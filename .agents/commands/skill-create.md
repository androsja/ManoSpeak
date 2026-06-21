---
description: Create or update a custom skill workflow configuration inside the `.agents/` directory (provided by the installed `deepworkplan` skill)
---

# /skill-create — provided by the `deepworkplan` skill

> Thin alias. The flow lives in the installed `deepworkplan` skill — this file only routes to it, so there is a single source of truth and no drift.

## What to do

Route this invocation to the **author** sub-skill of the installed `deepworkplan` skill and follow it: read `/Users/jflorezgaleano/.gemini/skills/deepworkplan/author/SKILL.md` and execute its flow.

> Other agents: invoke the skill's `deepworkplan-author` sub-skill directly (`/deepworkplan-author` in Claude Code, `#deepworkplan-author` elsewhere). This `skill-create` file is the shorter, conventional alias.
