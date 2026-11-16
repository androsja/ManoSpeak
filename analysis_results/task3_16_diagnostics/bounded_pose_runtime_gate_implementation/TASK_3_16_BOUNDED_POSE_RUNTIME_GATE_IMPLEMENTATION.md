# Task 3.16 bounded-pose runtime gate: evidence-gated stop

## Decision

**No runtime implementation was made.** The gate condition for implementation is not met: the saved collision poses are explicitly diagnostic-only, emit no renderer frames, and are not admitted as playable samples. The profile-bound collision candidate is also not the GLB loaded by the current runtime build. There is therefore no evidenced positive in-domain renderer request against which to implement and test the required v4 entrypoint. A deny-all stub would not implement the requested exact-pose path; mapping the samples to the existing joint-frame API would require an unapproved semantic conversion.

This report and its checksum are the only files created for this work unit. No code, profile, candidate, tests, or DWP status/checkpoint files changed. Task 3.16 remains partial; no collision measurements or test suites were run.

## Evidence reviewed

The formal exit condition is to extend the validated pose set and relevant collision geometry, or establish measured supported-pose bounds, while keeping unsupported scope fail-closed (`.dwp/plans/PLAN_lsc_motion_dsl_v4/tasks/3_coordinate_rig_contract.md:485`). The exact saved domain contains four maps: `neutral-rest`, `left-index-curl-v1`, and corrected left/right hand diagnostics. The two collision JSON reports are byte-identical, SHA-256 `27015fd35c1b4d029aa8a2c538477c36f6baf00a4d97c51ef489577ff5022e2a`, and report zero detected overlaps for those configurations. Their result is finite geometric observation only.

The compiler-domain report explicitly labels every admitted map `diagnostic-only-no-motion-emitted`; it says the compiler emits no motion frames and does not establish playback support. Its SHA-256 is `104f122014eb59b3d90b46cf8a50225abf8dbf86fcabe172d7cf15ab36aaebdb`. The bounded-domain summary SHA-256 is `63acfc507b89fda98a50d9543114a5f26d4918a2d3fff96f7a2e910e0b4f034e`; it also states that no runtime support domain is established. The recorded evidence binds candidate `748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a` and historical rev8 measurement-basis profile digest `c8d77d81161fcc70a6340637c3eb3635e26ce231a16afcddf941f5e9317eec8d`.

The live profile file is SHA-256 `fb5ae6bc26cee45da42a4c3ab9769db8496e0ce996595b1174a053afafc3a0a1`; its stored and independently recomputed canonical profile digest is `c97937e3642cfae25dbbbb91fdd4ed62228ecc17d062a6c13443c556097ced54`, and it still binds candidate `748ed69a…`. The current default packaged runtime GLB, `mobile/assets/models/vozual_woman_avatar_hands_v4_mobile.glb`, is SHA-256 `f51d54dfe0149ec45155b9bddbfcccbb28f6bc1b52c04c0a4e7ec0371f2b2fdd`, which differs from the measured candidate. `build-avatar-runtime.sh:7` selects that file by default. `avatar-runtime.ts` fetches and parses the runtime GLB (`:3588–3607`) but does not bind its byte digest to the Task 3.16 collision candidate.

## Current contract and exact gap

- `mobile/tools/compile-motion-v4.cjs:32–79,82–112` accepts the Task 3 conformance-only recipe and emits `durationMs: 0`, `frames: []`; it has no renderer-frame construction path.
- `mobile/tools/rig-mechanical-conformance.cjs:77–141` verifies exact discrete diagnostic maps and labels the result `diagnostic-only-no-motion-emitted`. `compile-motion-v4.test.ts:133–210` covers exact diagnostic maps, altered/unknown/coupled inputs and a measured-collision rejection, but only at compiler diagnostic level.
- The renderer contract in `avatar-runtime.ts:205–224` is `KinematicRuntimePlan` with wrist/hand/non-manual frames. Its loader (`:4561–4576`) only checks the plan envelope. `playVozualKinematicPlan` (`:4816–4868`) applies frame 0 after shallow validation, and later frames apply at `:5147–5155` without Task 3.16 domain membership checks.
- Existing clip routing (`avatar-runtime.ts:4776–4802`) falls back to compact playback when a kinematic plan fails to load or is rejected. It does not provide the requested v4-only rejection behavior.
- `KinematicRigBinding.ts:72–88` maps semantically named joint flexion/abduction/twist values to deform-bone Euler components (with mirrored abduction). That is not a canonical, reviewed conversion from the recorded raw radian maps to a renderer frame. Using it would assign unsupported anatomical semantics; the live profile continues to mark `degreesOfFreedom` and `jointLimits` unsupported.

Thus the current evidence does **not** prove: exact sample-to-renderer-frame mapping; candidate identity of the loaded runtime mesh; pre-mutation rejection at a v4 renderer boundary; absence of v3/compact fallback for a rejected bounded request; or collision-domain hash verification by playback. No anatomical safety, supported DOF, or safe range is inferred.

## Minimal next decision before implementation

The plan owner must choose and record one target:

1. **Use the measured candidate:** approve a product asset path that loads candidate SHA `748ed69a…` (and make runtime verify the loaded bytes), then define/review a versioned, non-anatomical mapping from each exact local XYZ-radian diagnostic map to a single renderer state and specify what remains unchanged at rest; or
2. **Use the current packaged GLB:** rerun and bind the same finite collision domain against its exact SHA `f51d54df…` before any positive runtime admission.

After that choice, publish a canonical domain digest usable by the runtime, define an isolated v4 API whose request binds candidate/profile/domain and carries only exact listed samples, and test acceptance plus unknown, epsilon-changed, coupled/interpolated, hash-mismatched, and colliding rejection **before any mutation**, with a spy proving rejection cannot call v3 or compact playback. Keep the existing frozen v3 API unchanged. Until these prerequisites exist, further runtime code would guess either asset identity or sample-to-frame semantics.

## Reproduction record

Commands run from repository root (read-only inspection and hashing):

```sh
shasum -a 256 \
  .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_16_diagnostics/TASK_3_16_COMPILER_DOMAIN.json \
  .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_16_diagnostics/TASK_3_16_BOUNDED_DOMAIN.json \
  .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_16_diagnostics/TASK_3_16_DOMAIN_COLLISIONS_RUN_1.json \
  .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_16_diagnostics/TASK_3_16_DOMAIN_COLLISIONS_RUN_2.json \
  schemas/rig-profiles/vozual-rig-1.v2.json \
  mobile/assets/models/vozual_woman_avatar_hands_v4_mobile.glb \
  .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/rig_candidates/748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a.glb
node - <<'NODE'
const fs=require('fs');
const {profileSha256}=require('./mobile/tools/rig-capability-profile.cjs');
const p=JSON.parse(fs.readFileSync('schemas/rig-profiles/vozual-rig-1.v2.json'));
console.log(JSON.stringify({stored:p.sha256,actual:profileSha256(p),candidate:p.asset.candidateSha256,
  dofs:p.descriptor.degreesOfFreedom.status,jointLimits:p.descriptor.jointLimits.status},null,2));
NODE
rg -n 'compileV4RigConformanceRecipe|durationMs: 0|frames: \[\]|diagnostic-only-no-motion-emitted' mobile/tools/compile-motion-v4.cjs mobile/tools/rig-mechanical-conformance.cjs
rg -n 'loadKinematicPlan|startLegacyPlayback|playVozualKinematicPlan|applyKinematicRiggedFrame\(activeKinematicPlan.frames' mobile/tools/avatar-runtime.ts
rg -n 'VOZUAL_AVATAR_SOURCE|vozual_woman_avatar_hands_v4_mobile.glb' mobile/tools/build-avatar-runtime.sh
```

Verified outcomes: profile canonical hash recomputation matched the stored value; profile candidate binding matches the collision candidate; packaged runtime GLB does not. The saved collision run files are identical. No Blender invocation, new measurement, Jest run, or runtime behavior claim was made.

## Source hashes

| File | SHA-256 |
|---|---|
| `TASK_3_16_COMPILER_DOMAIN.json` | `104f122014eb59b3d90b46cf8a50225abf8dbf86fcabe172d7cf15ab36aaebdb` |
| `TASK_3_16_BOUNDED_DOMAIN.json` | `63acfc507b89fda98a50d9543114a5f26d4918a2d3fff96f7a2e910e0b4f034e` |
| `TASK_3_16_DOMAIN_COLLISIONS_RUN_1.json` / `_2.json` | `27015fd35c1b4d029aa8a2c538477c36f6baf00a4d97c51ef489577ff5022e2a` / identical |
| `schemas/rig-profiles/vozual-rig-1.v2.json` | `fb5ae6bc26cee45da42a4c3ab9769db8496e0ce996595b1174a053afafc3a0a1` |
| `mobile/tools/compile-motion-v4.cjs` | `0c9809e7a9a02ae9db5d7fe28974e3d82eb0b43ed4e44931f9c167721a68cf8c` |
| `mobile/tools/rig-mechanical-conformance.cjs` | `48374f3c1d7593bc3cfbb33cbbf43ee0bce044232c2c301017e1d90e58dfe8e3` |
| `mobile/tools/avatar-runtime.ts` | `2fde4e44ac18bd077618706fbe1b499c8ce4e9dba24f6cc703319ed754d07337` |
| `mobile/src/services/KinematicRigBinding.ts` | `1f33cba72d468eae7844dfbeb73dd034ec1a372add06a48db4d2ac03a65512b4` |
| `mobile/tools/__tests__/compile-motion-v4.test.ts` | `a5221b3e02f49759698f0be6e13077cc7a80c1cc62162d44cd83d5257415317f` |
| measured candidate GLB | `748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a` |
| default packaged runtime GLB | `f51d54dfe0149ec45155b9bddbfcccbb28f6bc1b52c04c0a4e7ec0371f2b2fdd` |
