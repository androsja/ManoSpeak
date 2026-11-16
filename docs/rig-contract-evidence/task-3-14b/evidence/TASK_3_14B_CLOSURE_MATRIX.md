# Task 3.14b verifier closure matrix — 2026-11-16

## Decision

The literal 3.14b technical exit is demonstrated for the user-approved finite, diagnostic-only mechanical-observation scope. This does not validate anatomy, safe limits, interpolation, or 3.14c. The DWP remains `partial`: PROGRESS records a separate durable-evidence/handoff dependency. The literal row does not expressly require a clean-checkout bundle, so that dependency does not negate the measured technical checks; under the current checkpoint expectation it does prevent administrative closure until the handoff is documented and a restored bundle is verified (or the moderator explicitly removes that dependency).

## Acceptance matrix

| Literal acceptance item | Current evidence | Finding |
|---|---|---|
| Bind observation/support scope to profile, candidate, and evidence hashes | Live standalone verifier SHA `37b5e2f33a6fa195bf16bd9e4d9c10f34b1fc55724ce81bb35aa46b3887e26a9` exits 0 (`MANIFEST.VERIFIED`). It binds candidate `748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a`, report raw `72356f1006f9dd43a87204f529b45a9874dd4fc2cd224ee866bc2fefeca9dc5c`, projection `cbf50837d5eb61b7e1bd969f3e3b513abed49fdc1629334c615ba1d1612dc81f`, manifest `842f62a30e0dd6aff8b19c510a9d57856718ee9ccc9e631f2c5a3891965562bb`, and inventory `e576d44fb13360d2fbff89ba455d2d89b6141c4c3f8f297b24e592818097abbf`. Current profile raw/full canonical: `fb5ae6bc26cee45da42a4c3ab9769db8496e0ce996595b1174a053afafc3a0a1` / `c97937e3642cfae25dbbbb91fdd4ed62228ecc17d062a6c13443c556097ced54`; the finite catalog basis is derived `7651784cc5aa3b3f48fcbc0176e8ef50dd4728fabe73ef181c9662907f4324a0`, while report basis `c8d77d81161fcc70a6340637c3eb3635e26ce231a16afcddf941f5e9317eec8d` is evidence-time. | **Pass locally.** Basis regression rerun in a disposable temp directory: positive current-profile case verified; rehashed non-evidence-field mutation rejected with expected basis mismatch; fixtures removed. |
| Validate every allowlisted point | New read-only full sweep of current catalog against `rig-mechanical-conformance.cjs`, joined to both source reports: 1,710/1,710 unique points, 30 bones, 57 rows/bone, 570/axis; zero missing source points or count mismatches. Two runs byte-identical, JSON SHA `d92d90327ca14f637be34a115c4e8f6463bded96c13d9c3623c049278f4bf803`. Outcomes: 90 neutral references, 1,385 nonzero accepts with zero recorded overlaps, 235 measured-collision rejections, zero unexpected results. | **Pass for the exact finite diagnostic catalog.** This reruns catalog classification, not Blender geometry measurements. Build-5 Blender report (`35da0ea587f8417b2a0bae313fc77309159a4965792fdb100def05cd6313ca9b`) is historical and bound to its then-current profile/catalog; do not describe it as a Blender replay of today’s P0 catalog. |
| Keep unsupported configurations rejected; make no interpolation/anatomical claim | Current focused Jest: `rig-capability-profile`, `rig-mechanical-evidence`, `compile-motion-v4`, and `v4-rig-compile-binding`: **4 suites / 44 tests passed, 0 skipped**. Test coverage includes candidate/profile/evidence binding, altered catalog/inventory, unlisted angles, multi-axis and combined probes, unsupported DOFs/limits, and pre-artifact failure cases. Live verifier says 171 bones / 1,026 signed samples / 1,026 weighted responses and explicitly labels anatomical DOFs and safe joint ranges unsupported; diagnostic compile emits no motion frames. | **Pass within the finite diagnostic scope.** No interpolation, arbitrary/coupled pose support, anatomical review, or safe-range claim. Task 3.14c remains distinct and pending. |

## Durable-evidence handoff and closure recommendation

The scope decision record SHA is `9f800f4c28f0aac619047b3cbb42ac22673cae2581578025326f1d87f4f6acd0`. The current plan evidence remains local under ignored `.dwp`; the measured response report, measurement tool, candidate/source inputs and integration are not yet verified as a durable restored bundle. PROGRESS explicitly leaves 3.14b partial pending permitted durable-evidence handling and restored-bundle verification. The next concrete handoff is to document the approved storage/retention route for the exact hash-bound evidence, then restore that bundle in a clean environment and rerun the standalone verifier plus focused validation. Do not move licensed/source assets or publish derived data without the separately required authorization.

**Recommendation:** technically ready against the literal finite-scope 3.14b exit; not ready for the currently recorded DWP administrative closure until the durable handoff is completed or the moderator explicitly declares it non-blocking. Keep state `partial` in this work unit. No state, status, checkpoint, profile, candidate, or product file was edited. No anatomy/approval conclusion is made.

## Exact commands and environment

Node `v25.2.1`; npm `11.6.2`; Jest `29.7.0`; Python `3.14.6`.

```sh
node --check .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/luna_high_review/verify_task3_14b_mechanical_manifest.cjs
node .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/luna_high_review/verify_task3_14b_mechanical_manifest.cjs
python3 - <<'PY'  # imported saved harness; redirected OUT to TemporaryDirectory
# import standalone_verifier_basis_reconciliation/test_basis_normalization.py
# run main(); temp fixture output was removed at exit
PY
(cd mobile && VOZUAL_RUN_TASK3_14B_REAL_EVIDENCE=1 npm test -- --runInBand tools/__tests__/rig-capability-profile.test.ts tools/__tests__/rig-mechanical-evidence.test.ts tools/__tests__/compile-motion-v4.test.ts tools/__tests__/v4-rig-compile-binding.test.ts)
node --check .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/verifier_closure_matrix_20261116/verify_current_catalog_sweep.cjs
node .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/verifier_closure_matrix_20261116/verify_current_catalog_sweep.cjs .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/verifier_closure_matrix_20261116/catalog_sweep_run_1.json
node .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/verifier_closure_matrix_20261116/verify_current_catalog_sweep.cjs .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/verifier_closure_matrix_20261116/catalog_sweep_run_2.json
cmp .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/verifier_closure_matrix_20261116/catalog_sweep_run_1.json .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/verifier_closure_matrix_20261116/catalog_sweep_run_2.json
```

Raw logs and both run JSONs are beside this report. Focused Jest log SHA-256 `c19992ae448c5c1a6fd4883e01c6019ad3716183426cd290bb30a0c10a09d6f9`; standalone verifier log `2728c2f1ad729e44f7e850ee4ed8d3c09389e3a83a37863f7f3efdfff62dcaba`; basis regression log `0ca433d9bfe57124163301d2a1ed44982120e30f118eec864dc5afa84e071adc`.

Current code hashes: conformance validator `48374f3c1d7593bc3cfbb33cbbf43ee0bce044232c2c301017e1d90e58dfe8e3`; evidence helper `c3bb5e8c1fc9662366af8fb3d4e57ee85c1d82468b98088f8fd6c7c9a191dad4`; profile validator `86f77569f0b60257c84dd61fbb9d5709154679fca4e1e51b1e1c3e4b535c9541`; v4 compiler `0c9809e7a9a02ae9db5d7fe28974e3d82eb0b43ed4e44931f9c167721a68cf8c`; v4 binding `a73279fcb81883c4bf80eaf387a2b9aa84471e06bfa2a5a7fcd6ea3c2aa3a47c`.

Relevant review integrity: standalone basis independent review report SHA `636835ab5bedbc43a463e4a5dc07202a21f8d9d84ae7418c8a370cf158199e6e` (its sidecar passes); README/verifier reconciliation report SHA `09cb322ef45902f2f418e093399af9b53d95e56f2c04c8c7d90903bdd1e52834` (sidecar passes and pins verifier `37b5…`). The older technical-closure review SHA `bf6251f7e448cbebe37187ba69c36893a72ed0e32bbfd07708661794a5a50b22` predates the corrected verifier and reports the former `7f589…` failure; it is superseded by the live verifier result above. The basis-reconciliation sidecar has 10/14 entries matching current bytes; its four shared state/README/PROGRESS/ledger snapshot pins are stale after subsequent edits, not evidence of a current verifier failure. Current task row remains partial; current task ledger SHA `ce5cddf6c0e637f6d032844814db85b9c94a20e2f056dad847873d27b908fce6`, PROGRESS SHA `cc5b8d70b4e69e82d00667b4f3ab08c78c4680fd4b6c57bc3c65512a2d8de7a6`, and state SHA `1c06cefd360fe65af538f429c985a6f40865d3c5765ef968fde288a28ddd4608`.
