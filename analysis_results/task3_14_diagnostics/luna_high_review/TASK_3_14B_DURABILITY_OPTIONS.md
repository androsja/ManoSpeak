# Task 3.14b Durability Options

**Review date:** 2026-11-15  
**Scope:** Read-only audit of whether the canonical mechanical evidence manifest and verifier can be retained in tracked files without licensed binaries, and of the remaining dependencies for another checkout to reproduce the observations. No binary was copied, promoted, or modified. No shared source file, profile, manifest, verifier, compiler, test, or task state was edited.

## Decision

**Yes: the manifest and verifier can be stored as tracked text/source files without storing the source ZIP, `.blend`, or candidate GLB.** They currently live under ignored `.dwp/`, however, and the manifest points to ignored or locally installed paths. Simply tracking their current bytes would not make the current verifier portable. A tracked handoff needs stable paths for textual evidence and a verifier that accepts an explicit local asset root (or separately reports which binary checks could not run).

Another checkout can validate the recorded observation without licensed binaries if it receives the response JSON and measurement script and validates their hashes, report projection, profile inventory and coverage. It **cannot independently reproduce the measurements or execute the current verifier** until it can access the exact source asset or an authorized byte-identical source, plus the pinned export and measurement toolchain.

## Current tracking and path audit

`.gitignore` explicitly excludes `.dwp/` (line 27) and `Personaje/` (line 37, described there as local credentials and purchased avatar source packages). The profile and canonicalization dependency are tracked; the current evidence and input binaries are not.

| Item | Current bytes / status | SHA-256 or identity | Handoff note |
|---|---|---|---|
| Canonical manifest | 2,302 bytes; under ignored `.dwp/` | `486968791b80e967e67427c177159e70d768ec2cd2abb3c0352fa5b767331821` | JSON text; can be tracked. Existing paths point into `.dwp/` and `Personaje/`. Rewriting paths changes canonical bytes and digest. |
| Node verifier | 9,080 bytes; under ignored `.dwp/` | `4d9e01cbf3bbb24cf8750d42d145d16d7ce7a88125222742faa0218b7fbb0fd5` | Source text; can be tracked. Its current root calculation assumes its current deeply nested location and its checks require every binary path to exist. |
| Response-by-bone report | 438,180 bytes; under ignored `.dwp/` | Raw `72356f1006f9dd43a87204f529b45a9874dd4fc2cd224ee866bc2fefeca9dc5c` | JSON measurement data, not an embedded GLB. Trackable as text in principle; rights to redistribute derived technical data were not established by the reviewed documents. |
| Measurement script | 6,703 bytes; under ignored `.dwp/` | `ec34e7262e9607a9f7bee6064061cf3d684b4a54110ea991713b1da1a01bde97` | Python source; can be tracked. Requires Blender's `bpy` and `mathutils` modules and the exact rig/candidate input. |
| Candidate GLB | 3,141,760 bytes; under ignored `.dwp/` | `748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a` | Binary; do not include in this text-only handoff. It was reproduced exactly in two recorded runs. |
| Original source ZIP | 91,173,596 bytes; under ignored `Personaje/` | `a17489dc9890b2b916a93bee25cf7892cb0227aadc4ed56e44a37ec4875efc96` | Purchased/licensed source package; do not include in Git by default. |
| Extracted source `.blend` | 145,834,348 bytes; under ignored `.dwp/` | `b0bcb07732b46c30d520397096518f76aec096320e69bca4725c13bcdcd6785` | Same source member as in the ZIP; a duplicate local copy, not required if a permitted checkout can extract the exact ZIP member. |
| Rev8 reproduction record | 5,770 bytes; under ignored `.dwp/` | `4a6a36af0db985585a36d6346951ab27a91952e2e1c379376579960dde7d1892` | Markdown record; can be tracked as text, subject to review of its derived asset metadata. |
| Profile rev8 | Tracked | Canonical SHA `c8d77d81161fcc70a6340637c3eb3635e26ce231a16afcddf941f5e9317eec8d` | Contains candidate/source hashes and the geometric inventory, not asset bytes. DOFs and limits remain unsupported. |
| Canonicalizer | Tracked at `mobile/tools/rig-capability-profile.cjs` | `5b78dce1363de50ec733fe4f3332af92480868fa934f45766171b5c14d052763` | Existing dependency needed for canonical JSON and digest checks. |

The manifest is ordinary canonical JSON and the verifier is JavaScript. Neither includes binary payloads. Their present digest/path design is local-specific: manifest fields name ignored DWP files, the verifier computes `ROOT` from its current nesting depth, reads the ZIP, candidate and extracted `.blend` unconditionally, and loads the report and measurement script from DWP paths. A tracked relocation therefore requires a new manifest canonical digest and a path-portable verifier version; retaining the current canonical digest while silently changing any path is not possible.

## Exact dependency for another checkout to reproduce the data

The candidate-specific record `TASK_3_14B_REV8_REPRO_ATTEMPT.md` has SHA-256 `4a6a36af0db985585a36d6346951ab27a91952e2e1c379376579960dde7d1892`. It reports two exports with Blender **5.2.3 LTS**, the exact exporter bytes SHA-256 **`82be4e67efe778c565a82514cda34d5a9565bbc3b2f381af5d2ccbd4fd07cdf1`**, and `--max-texture-size 256`. Both outputs were 3,141,760 bytes and matched each other and candidate SHA `748ed69…fc3de26a`. The recorded processes exited 134 after writing valid, byte-identical outputs; the reproduction record treats this as an abnormal shutdown, not a failed byte comparison.

The exact missing cross-checkout dependency is authorized access to the source bytes matching archive SHA `a17489…5efc96` (or the exact extracted member SHA `b0bcb0…cd6785`). With that source, the pinned exporter bytes and Blender 5.2.3/256-pixel recipe can regenerate the candidate; the candidate GLB need not be stored centrally if the generated SHA is checked against `748ed69…fc3de26a`. Then the tracked profile rev8, measurement script SHA `ec34e7…01bde97`, and Blender 5.2.3 can rerun the per-bone measurement. For comparison, the verifier currently also insists on a separate extracted `.blend` file even though the ZIP contains exactly that `Blender.blend` member; a future portable verifier could hash the archive member and omit this redundant stored copy.

There is a source-control caveat: the worktree exporter is SHA `82be4e67…07cdf1`, but `git show HEAD:mobile/tools/prepare-rigged-avatar.py` hashes to `0658ffd32533844a066adab0cf0854fe8645f59eecf854a7a7a364b6529dfdef`; the exporter is modified in this checkout. A fresh clone of current `HEAD` therefore does not have the exporter bytes used by the confirmed reproduction. Those exact source bytes must become durably available (for example, in a reviewed source change or a separately retained reproducibility package) before another checkout can repeat the export. The later measurement tool is a separate DWP-only script and also must be tracked or otherwise supplied at its pinned hash.

The full chain for a fresh reproduction is therefore:

1. Authorized access to the exact source ZIP or exact `.blend` member (or a newly selected authorized source, which would require new evidence and hashes).
2. Exporter bytes `82be4e67…07cdf1`, Blender 5.2.3 LTS, and `--max-texture-size 256`; regenerate and verify candidate SHA `748ed69…fc3de26a`.
3. Profile rev8 and measurement tool bytes `ec34e7…01bde97`; rerun the isolated XYZ ±10° response measurement in Blender and compare report SHA/projection.
4. Run a portable verifier over tracked manifest/report/tool/profile/canonicalizer plus the locally generated candidate and authorized source input.

Without item 1, another checkout can verify hashes and coverage of a tracked response report but cannot regenerate the candidate-bound data. Without item 2, the exact candidate cannot be regenerated. Without the measurement script, only the saved report can be audited; it cannot be reproduced from geometry.

## Technically viable text-only handoff

A viable option that does not place licensed binaries in Git is a **tracked evidence bundle plus locally supplied licensed inputs**:

- Track canonical manifest JSON, the response JSON, the measurement script, the candidate-specific reproduction record, and a verifier under a stable `analysis_results/task3_14_diagnostics/luna_high_review/` path. These are text/source artifacts. Before handoff, review whether the detailed derived geometry report and reproduction metadata may be redistributed under the asset licence.
- Update manifest path fields to stable tracked paths for text/profile/source declarations and record the resulting new canonical manifest digest. Do not change profile/compiler/status as part of this audit. The existing manifest digest `486968…331821` identifies the current DWP-path version only.
- Make the verifier locate the repository root independently of its file depth and accept a caller-provided local asset directory for licensed source/candidate inputs. It should clearly distinguish complete verification from report-only verification; missing licensed inputs must not be reported as full `MANIFEST.VERIFIED`.
- Document the pinned source hash, exporter hash, Blender version/options, candidate output hash, measurement tool hash, and exact commands. A checkout with authorized local access can run the complete chain; a checkout without it can validate the durable report's content, canonical projection, inventory and sample coverage while explicitly leaving source/candidate byte checks unverified.

This option keeps source archive, `.blend`, and GLB outside the repository. To make complete reproduction available to multiple authorized checkouts, the owner would need to select an access-controlled, immutable artifact store that permits those users to retrieve the exact licensed source. Merely recording a SHA-256 or a private path preserves identity but does not grant access, supply the bytes, or make the evidence reproducible.

## Licence and storage boundaries

The repository's `.gitignore` labels `Personaje/` as local purchased avatar source packages. The exporter calls the source licensed/purchased and says the purchased source is never modified. `docs/AVATAR_ASSET_DECISION.md` describes the prior CGTrader source as having a no-AI designation and unresolved incorporated-product evidence, and says it is legacy user-owned source rather than the basis for the new character. `docs/SPEECH_TO_LSC_AVATAR_CONTRACT.md` says source archives are excluded from the app and requires every playable derivative to record source/derivative checksums, licence and attribution; `docs/AVATAR_ASSET_DECISION.md` requires licence/provenance metadata for publication.

No license document, attribution record, or permission to redistribute the source, derivative GLB, or detailed derived measurements was found in the reviewed locations. “Purchased” or “user-owned” does not by itself establish permission to put these bytes in a public repository or shared storage. This audit does not interpret the licence. Keep binaries out of Git and do not select a shared/cloud store until the rights holder's terms and access boundary are confirmed. An internal restricted store may be technically suitable, but it is not approved by the evidence reviewed here.

## Current verification result and limits

The manifest verifier was run from the repository root during this audit and returned `MANIFEST.VERIFIED`: manifest SHA `486968791b80e967e67427c177159e70d768ec2cd2abb3c0352fa5b767331821`; candidate SHA `748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a`; report SHA `72356f1006f9dd43a87204f529b45a9874dd4fc2cd224ee866bc2fefeca9dc5c`; report projection SHA `cbf50837d5eb61b7e1bd969f3e3b513abed49fdc1629334c615ba1d1612dc81f`; inventory SHA `e576d44fb13360d2fbff89ba455d2d89b6141c4c3f8f297b24e592818097abbf`; **171 bones / 1,026 signed probes / 1,026 with weighted displacement**.

This pass assesses evidence retention/reproduction only. It does not integrate the manifest into the profile or compiler, assert anatomical DOFs or safe limits, or change the current partial Task 3.14b status.
