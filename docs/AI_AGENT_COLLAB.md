# AI Agent Collaboration — ManoSpeak

This guide defines how agents cooperate, document tasks, and coordinate implementation boundaries when working in parallel.

## 1. Concurrency and Handoffs
- **Commit Boundary isolation:** When writing code, isolate commits between the `ml/` folder and the `mobile/` folder. This minimizes merge conflicts and keeps PRs readable.
- **Deep Work Plans:** Always use `/dwp-create` to generate a structured work plan before starting complex, multi-step tasks.
- **Handoff notes:** If a task is interrupted or requires switching agents, write the status to `.dwp/plans/` and leave a summary message explaining the current state, obstacles, and next actions.

## 2. Shared Interface Contracts
- **Landmark Array Shape:** The bridge coordinates array shape must match `[543, 3]`. Any changes to standard coordinate sizes must be coordinated across both the PyTorch exporter in `ml/` and the interpreter bridge in `mobile/`.
- **Model Signatures:** Keep the TFLite input tensor signature fixed at `[1, temporal_length, 543, 3]`. Changing input sizes breaks mobile runtime integration.
