# Task 3.14b Mechanical Manifest — Independent Review

**Review date:** 2026-11-15  
**Scope:** Read-only verification of the local 3.14b evidence-manifest prototype. No manifest, profile, compiler, tests, task state, or profile declarations were changed.

## Verdicts

| Dimension | Verdict | Basis |
|---|---|---|
| Technical validity of this prototype | **PASS, within its stated observational scope** | The Node verifier passed from the repository root. Independent SHA-256 recomputation matched the manifest, response report, canonical report projection, rev8 candidate, and profile inventory. It verified exact bone/sample coverage and weighted-surface displacement. |
| Artifact durability | **FAIL** | The manifest prototype, response report, measurement tool, candidate, source archive and source `.blend` are local and ignored or otherwise untracked. The report cannot be reproduced from durable tracked inputs in this checkout. |
| Formal 3.14b completion criterion | **NOT SATISFIED** | This is a valid local evidence prototype, but its manifest is not bound into the profile/compiler conformance artifact and is not a durable repository reference. The full-inventory response remains observational; the compiler's executable allowlist is a separate finite 30-bone catalog. Unsupported requests remain fail-closed in that existing catalog, but the 171-bone report itself is not a compiler capability. |

The prototype supports only the claim that the exact measured candidate showed weighted-surface response to the listed isolated local Euler XYZ ±10° probes. It establishes neither anatomical DOFs nor safe joint ranges, coupled support, collision-free paths, or publication support.

## Verification performed

From the repository root, ran:

```sh
node .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/luna_high_review/verify_task3_14b_mechanical_manifest.cjs
```

Result: `MANIFEST.VERIFIED`; **171 bones, 1,026 signed axis samples, and 1,026 samples with weighted displacement**. The verifier also confirmed the candidate/profile binding, source archive and embedded source blend hashes, measurement-tool hash, report schema, exact inventory IDs, exact ±10° signs/axes, expected measured surfaces, and unsupported DOF/joint-limit declarations.

I then independently recalculated the requested digests using Node's SHA-256 implementation and the repository's `canonicalJson` function. File SHA and canonical manifest SHA coincide because the manifest bytes are canonical compact sorted JSON.

| Artifact | Independently recalculated SHA-256 | Result |
|---|---|---|
| Canonical evidence manifest (also raw file SHA) | `486968791b80e967e67427c177159e70d768ec2cd2abb3c0352fa5b767331821` | Matches |
| Full-inventory response-by-bone report, raw bytes | `72356f1006f9dd43a87204f529b45a9874dd4fc2cd224ee866bc2fefeca9dc5c` | Matches |
| Canonical response projection after deleting only top-level `profileSha256` | `cbf50837d5eb61b7e1bd969f3e3b513abed49fdc1629334c615ba1d1612dc81f` | Matches |
| Profile-bound rev8 candidate GLB | `748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a` | Matches declared candidate identity |
| Profile `restAxesInventory`, canonical content excluding its own `sha256` field | `e576d44fb13360d2fbff89ba455d2d89b6141c4c3f8f297b24e592818097abbf` | Matches |
| Profile rev8 canonical SHA-256 | `c8d77d81161fcc70a6340637c3eb3635e26ce231a16afcddf941f5e9317eec8d` | Recalculated for cycle check |

The manifest identifies the candidate, source archive/source blend, inventory, report projection, measurement tool, and canonicalizer. Its profile path is used to read the candidate and inventory bindings; the manifest has no `profileSha256` field and contains no current profile digest value. Conversely, the profile does not contain the manifest digest. The report's raw bytes do contain profile digest `c8d77d…`, but that one top-level identity field is omitted from the canonical report projection whose digest the manifest binds. **No SHA cycle exists in the reviewed binding.** Profile declarations for both degrees of freedom and joint limits remain `unsupported`.

## Coverage assessment

The inventory has 171 unique bone IDs and the report has exactly one record for each matching ID. For each bone the verifier found X/Y/Z probes at both −10° and +10°: six samples per bone, or 1,026 total. All 1,026 samples report positive displacement on at least one positively weighted surface. This verifies sample coverage and response metrics for this report; it does not infer anatomical meaning or safe motion.

## Durability and reproducibility

`git check-ignore` confirms that the evidence manifest, response report, measurement script, and candidate are under the ignored `.dwp/` tree. The source archive is ignored under `Personaje/`; the source `.blend` copy is also in `.dwp/`. These exact bytes are present locally, so the successful verification is real for this checkout, but the evidence set is not durable/tracked.

The supporting local export-reproducibility audit reports that two fresh exports were byte-identical to each other but did **not** reproduce the profile-bound rev8 candidate: they produced `a5e26c…`, not `748ed69…`. A separate bounded recipe search identifies `--max-texture-size 256` as a plausible missing option but does not confirm it reproduces rev8. Those audits were inspected as supporting records; export was not rerun in this review. Thus the candidate hash verifies the present local file, while exact candidate regeneration is not established by the recorded recipe.

The existing profile/compiler path also does not consume this manifest or the 171-bone report. The 171-bone report hash is absent from profile and compiler conformance bindings; the compiler's finite exact diagnostic catalog is scoped to 30 bones / 1,710 rows. The manifest README itself lists durable evidence placement and profile/compiler/test integration as pending. As a result, technical verification of this standalone manifest does not close the formal 3.14b criterion to bind the observed/support scope, validate its declared support domain, and reject unsupported configurations through the product conformance path.

## Formal criterion decision

**3.14b is not complete.** The prototype meets the local evidence-integrity portion: it binds exact observed data to the candidate and rest-axis inventory without a profile hash cycle, verifies all declared observations, and keeps anatomical DOFs and safe ranges unsupported. It does not meet the complete criterion because this evidence is not durable and is not bound/enforced by the profile/compiler conformance path. The pre-existing exact diagnostic catalog's fail-closed behavior is useful but cannot be treated as enforcement of the independent 171-bone observation report.

This decision is consistent with the current Task 3 ledger, which marks 3.14b partial. No state or status file was modified.

## Commands and boundaries

Commands run from the repository root:

```sh
node .dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/task3_14_diagnostics/luna_high_review/verify_task3_14b_mechanical_manifest.cjs
node - <<'NODE'
// Recomputed canonical/raw manifest and report hashes, report projection hash,
// candidate hash, inventory hash, canonical profile hash, coverage and cycle checks.
NODE
git check-ignore -v <manifest> <report> <measurement-tool> <candidate> <source-archive>
```

No tests were run because this was a read-only evidence review and the requested verification was the Node manifest verifier. The only new file is this review report at the requested destination.

## Addendum — rev8 candidate reproduction evidence (2026-11-15)

This addendum supersedes the earlier statement above that exact candidate regeneration was not established. Reinspection of `TASK_3_14B_REV8_REPRO_ATTEMPT.md` confirms that the correct recipe was run twice and reproduced the exact profile-bound rev8 candidate. I independently recalculated that report's raw SHA-256 as:

`4a6a36af0db985585a36d6346951ab27a91952e2e1c379376579960dde7d1892`

The report records Blender 5.2.3 LTS, source ZIP SHA-256 `a17489dc9890b2b916a93bee25cf7892cb0227aadc4ed56e44a37ec4875efc96`, extracted source `.blend` SHA-256 `b0bcb07732b46c30d520397096518f76aec096320e69bca4725c13bcdcd6785`, exporter SHA-256 `82be4e67efe778c565a82514cda34d5a9565bbc3b2f381af5d2ccbd4fd07cdf1`, and the explicit `--max-texture-size 256` option. Both fresh outputs were 3,141,760 bytes and SHA-256 `748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a`, matching each other and the existing rev8 candidate. The report records both byte comparisons (`cmp`) returning 0.

**Reconciled reproducibility verdict: PASS for the exact recorded local recipe and candidate.** Blender exited 134 after writing each output and emitted shutdown warnings; this is an abnormal process exit, but the completed outputs were reported byte-identical to the known GLB. It does not negate the byte-for-byte reproduction evidence. The earlier default-1024 export result was not the applicable recipe; explicit texture size 256 accounts for the exact match in the reported runs.

This correction does not change the **artifact durability** verdict: the source, candidate and reproduction materials remain in ignored/local locations, so this checkout still lacks a durable tracked evidence package. It also does not change the **formal 3.14b** verdict: the evidence manifest is not integrated into the profile/compiler conformance path, and the 171-bone measurements remain observations rather than executable capability. No candidate, profile, manifest, compiler, tests or status was changed in this addendum.

The manifest verifier was rerun from the repository root after reviewing the reproduction report and returned `MANIFEST.VERIFIED`: manifest SHA-256 `486968791b80e967e67427c177159e70d768ec2cd2abb3c0352fa5b767331821`; candidate SHA-256 `748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a`; inventory SHA-256 `e576d44fb13360d2fbff89ba455d2d89b6141c4c3f8f297b24e592818097abbf`; response projection SHA-256 `cbf50837d5eb61b7e1bd969f3e3b513abed49fdc1629334c615ba1d1612dc81f`; raw report SHA-256 `72356f1006f9dd43a87204f529b45a9874dd4fc2cd224ee866bc2fefeca9dc5c`; coverage **171 bones / 1,026 signed samples / 1,026 with weighted displacement**.
