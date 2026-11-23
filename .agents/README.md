# Agent Configurations — Vozual

This directory contains the custom persona guides, command scripts, and catalog documentation for the **Vozual** agent harness.

## Contents
- **`agents/`:** Custom developer, researcher, and architect personas.
- **`commands/`:** Thin alias delegators mapping `/dwp-*` calls to the project-local Codex skill at `skills/deepworkplan/SKILL.md`.
- **`skills/deepworkplan/`:** Versioned Deep Work Plan workflows shared by the command aliases.
- **`docs/`:** Master references for active commands and personas.
- **`settings.json`:** Global project parameters and execution policies.

## Active Vozual Personas

- [Ticket Status Moderator](agents/ticket-moderator.md): Separate Herdr agent for evidence-based DWP ticket status reports. Its current session is `wC:pE` in the Moderador tab, distinct from the primary moderator at `wC:p6`.
