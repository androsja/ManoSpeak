# Independent review — standalone verifier basis and README

**Result: pass for the inspected local evidence.** The active 3.14b exit requires binding the claimed scope to profile/candidate/evidence hashes, validating every allowlisted point, rejecting unsupported configurations, and making no interpolation or anatomical claim. This review addresses the standalone verifier and README reconciliation; the DWP row remains `partial` and this is not an acceptance decision for the whole task.

- Both upstream `SHA256SUMS` files verified all entries from repository root: basis reconciliation **14/14** and README reconciliation **8/8**. Reports SHA-256: basis `02901b874f38a1b8ae9a429513d1b8949d7d3b60a2ab31903d1326dd897150d6`; README `09cb322ef45902f2f418e093399af9b53d95e56f2c04c8c7d90903bdd1e52834`.
- README SHA `028ad9a5d8afbfb4df1df3177b9896d7ced1ed95e7a4d8c15a59a01c29d4e3f3` records current verifier SHA `37b5e2f33a6fa195bf16bd9e4d9c10f34b1fc55724ce81bb35aa46b3887e26a9`; live verifier bytes match. Its wording agrees with verifier lines 108–113: derive the measurement basis after deleting both mechanical and visual evidence descriptors, then compare to the report profile digest.
- `node --check` exited 0; the live verifier exited 0 with `MANIFEST.VERIFIED`, 171 bones, 1,026 signed samples and 1,026 weighted responses. Its manifest SHA is `842f62a30e0dd6aff8b19c510a9d57856718ee9ccc9e631f2c5a3891965562bb`.
- Independently reran the standalone regression in a temporary directory without overwriting its saved results. Positive current-profile case returned `MANIFEST.VERIFIED`; negative case changed `anthropometricsM.shoulderWidth` by 0.001, recomputed the profile self-hash, and was rejected with the expected derived-basis mismatch (exit 1). Temporary fixtures were removed. This is one non-evidence-field negative example.
- With `VOZUAL_RUN_TASK3_14B_REAL_EVIDENCE=1`, focused `rig-mechanical-evidence.test.ts` passed **1 suite / 13 tests**, including the real local positive integration and synthetic negative cases. No tests skipped. Node `v20.19.4`, Python `3.14.6`.

## Reproduction

From repository root:

```sh
shasum -a 256 -c .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/standalone_verifier_basis_reconciliation/SHA256SUMS
shasum -a 256 -c .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/README_verifier_hash_reconciliation/SHA256SUMS
node --check .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/luna_high_review/verify_task3_14b_mechanical_manifest.cjs
node .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/luna_high_review/verify_task3_14b_mechanical_manifest.cjs
python3 - <<'PY'
from pathlib import Path
import tempfile
p=Path('.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/standalone_verifier_basis_reconciliation/test_basis_normalization.py').resolve()
with tempfile.TemporaryDirectory(prefix='review_basis_') as temp:
 code=p.read_text().replace('OUT = Path(__file__).resolve().parent',f'OUT = Path({temp!r})')
 exec(compile(code,str(p),'exec'),{'__name__':'__main__','__file__':str(p)})
PY
(cd mobile && VOZUAL_RUN_TASK3_14B_REAL_EVIDENCE=1 npm test -- --runInBand tools/__tests__/rig-mechanical-evidence.test.ts)
```

The temporary harness changes only its output directory in memory; it copies fixture text and symlinks binary inputs as in the reviewed harness. Results are local to the present files; no clean-checkout verification or shared status edit was performed.
