# Task 3.14b Durable Evidence Bundle

This repository path contains the derived-only Task 3.14b mechanical-observation package. The archive `task-3-14b-derived-evidence.tar.gz` was extracted into a fresh temporary directory and verified with `verify_bundle.py`; see `RESTORE_VERIFICATION.md` for the archive digest and exact result.

The bundle includes hash-bound reports, JSON profile/catalog inputs, reproduction and verification scripts, and captured validation logs. It intentionally excludes the source `.blend`, candidate `.glb`, source ZIP, and other avatar/source binaries. Their provenance hashes are recorded inside `BUNDLE_README.md` and the measurement manifest.

This route and archive are currently untracked local files. They have not been committed, pushed, or transferred to another agent or durable remote. Therefore the recorded DWP handoff dependency remains open and Task 3.14b remains `partial`. Do not treat the restore test as source-asset reproduction: it verifies bundle integrity/restoration and determinism of the two captured catalog outputs only.
