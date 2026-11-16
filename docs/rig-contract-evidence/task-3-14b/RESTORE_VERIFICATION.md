# Restore Verification

- Archive: `task-3-14b-derived-evidence.tar.gz`
- Archive SHA-256: `7b34f7ca9cbf5b99413f2446c4d6ef7078a1fff8ecfa67e8f5e1aef1369bd4f8`
- Restored to a fresh temporary directory and ran `python3 verify_bundle.py`: **passed**.
- Result: `BUNDLE.VERIFIED files=24 forbidden_source_assets=0`.
- The two captured catalog-sweep JSON outputs were byte-identical after extraction (SHA-256 `d92d90327ca14f637be34a115c4e8f6463bded96c13d9c3623c049278f4bf803`).
- This verifies archive integrity and faithful restoration of the derived bundle. It does not reproduce the original Blender measurement and does not include the source `.blend`, candidate `.glb`, or source ZIP.
- The bundle directory/archive are local and untracked; no commit or external transfer occurred.
