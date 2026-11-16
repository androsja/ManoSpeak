# Task 3.14b Mechanical Evidence Bundle

This bundle preserves the user-approved finite, diagnostic-only mechanical-observation evidence for Task 3.14b. It contains derived reports, JSON profile/catalog inputs, reproduction and verification code, and captured validation logs. It does not contain the source Blender project, avatar candidate GLB, or source ZIP.

## Evidence scope

- 171 profile bones have signed local-axis response observations at ±10° (1,026 samples). These are observed mechanical responses, not anatomical DOFs.
- The finite diagnostic catalog contains 1,710 discrete points across 30 bones: 1,385 accepted nonzero points, 235 collision rejections, and 90 neutral references.
- Anatomical DOFs and safe joint ranges remain `unsupported`. No interpolation, arbitrary/coupled motion, general collision clearance, linguistic realization, candidate adoption, or publication is established.
- The catalog sweep classifies the recorded discrete observations against the current validator. It is not a new Blender geometry measurement.

## Provenance references (source binaries intentionally excluded)

| Input | SHA-256 |
|---|---|
| Candidate GLB rev8 | `748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a` |
| Source `Blender.blend` | `b0bcb07732b46c30d520397096518f76aec096320e69bca472c5a13bcdcd6785` |
| Source archive ZIP | `a17489dc9890b2b916a93bee25cf7892cb0227aadc4ed56e44a37ec4875efc96` |
| Measurement-basis profile canonical digest | `c8d77d81161fcc70a6340637c3eb3635e26ce231a16afcddf941f5e9317eec8d` |
| Full profile canonical digest at recorded scope approval | `c97937e3642cfae25dbbbb91fdd4ed62228ecc17d062a6c13443c556097ced54` |
| Rest-axis inventory digest | `e576d44fb13360d2fbff89ba455d2d89b6141c4c3f8f297b24e592818097abbf` |

The raw report hash and canonical projection binding are in `evidence/TASK_3_14B_MECHANICAL_EVIDENCE_MANIFEST.v1.json`. The source hashes are references only; this bundle cannot reproduce the original Blender measurement without those source assets and the original runtime environment.

## Contents

- `evidence/`: measured response JSON, binding manifest, finite-catalog sweep output, closure matrix, scope approval, independent review, and input reports.
- `profile/`: exact JSON profile and isolated-probe catalog used by the recorded current-catalog sweep.
- `reproduction/`: measurement, manifest, and catalog verification scripts plus the validator/canonicalizer dependencies.
- `validation/`: captured logs and a second catalog-sweep output for determinism comparison.
- `SHA256SUMS.txt`: file-level integrity manifest for all bundle files except itself and the archive.
- `verify_bundle.py`: offline verifier for the integrity manifest and source-binary exclusion rules.

## Restore and verify

From the extracted bundle root, run:

```sh
python3 verify_bundle.py
```

The manifest-verification command checks byte hashes and rejects `.blend`, `.glb`, and `.zip` files. To rerun the recorded catalog classification, use a compatible repository checkout containing the mobile validator and profile paths expected by `reproduction/verify_current_catalog_sweep.cjs`; its output path is supplied as the sole argument. The standalone mechanical manifest verifier also expects the original repository paths and source candidate/archive, which are intentionally excluded here.

This is a local repository bundle. Its presence here does not imply a commit, push, remote backup, transfer to other agents, or distribution-rights approval.

`RESTORE_VERIFICATION.md` records the archive hash and the completed temporary extraction check. It is written after archive creation and is intentionally outside the archive and its SHA256SUMS file to avoid a self-referential archive receipt.
