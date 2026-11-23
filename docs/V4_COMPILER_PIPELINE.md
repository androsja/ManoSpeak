# V4 compiler pipeline status

`mobile/tools/v4-compiler-pipeline.cjs` currently exposes two deterministic,
immutable authoring/diagnostic pipeline entry points. The v4 rig-conformance
entry parses JSON input, applies the existing semantic validator, canonicalizes
the source, binds the exact rig/candidate evidence, and packages the diagnostic
artifact with a hash-bound validation report and unsigned publication-candidate
metadata. The temporal entry expands the existing Task 5 timeline fixture into
an authoring IR while preserving opaque intent references.

## Implemented capability IDs

| Capability ID | Current behavior | Conformance evidence |
| --- | --- | --- |
| `compiler.v4.parse-json` | Accepts an object or JSON bytes; rejects invalid roots and malformed JSON with a `parse` diagnostic. | `v4-compiler-pipeline.test.ts` |
| `compiler.v4.immutable-source-ir` | Produces a deeply frozen, canonical source IR without mutating the caller's object; the public IR shape has a strict TypeScript declaration. | `v4-compiler-pipeline.test.ts`; `v4-compiler-pipeline.types.ts` |
| `compiler.v4.rig-conformance` | Reuses the exact-candidate and profile-bound diagnostic compiler; output has zero motion frames. | `compile-motion-v4.test.ts`; `v4-compiler-pipeline.test.ts` |
| `compiler.v4.deterministic-package` | Emits canonical artifact/report JSON and SHA-256 digests for equivalent source inputs. | `v4-compiler-pipeline.test.ts` |
| `compiler.v4.publication-candidate-metadata` | Emits deterministic compatibility/provenance and content-addressing metadata; signing remains assigned to the trusted publisher. | `v4-compiler-pipeline.test.ts` |
| `compiler.v4.fail-closed-motion-graph` | Rejects nonempty executable temporal graphs because their compiler semantics are not implemented here. | `v4-compiler-pipeline.test.ts` |
| `compiler.v4.temporal-authoring-expansion` | Expands Task 5's `temporal-composition-intent` v1 into an immutable timeline IR with repeated segment IDs and opaque references preserved. | `v4-compiler-pipeline.test.ts`; `multichannel-contours.expected.json` |

## Passes not implemented by this slice

This pipeline does not produce executable motion graphs, solve shared joint
variables, sample motion, optimize executable plans, or issue signatures. The
reports mark sampling and optimization as skipped and signing as deferred or
not applicable. It does not create frames, make network or Firebase requests,
or change approval or release state. Neither an authoring timeline nor a
zero-frame diagnostic artifact proves runtime conformance or physical safety.

Task 7's accepted V1 diagnostic scope does not establish continuous collision,
general coupled solving, anatomical limits, or visibility. Task 8's V1 scope is
documentary and authoring-only. Those deferred capabilities remain explicit
gates; this document does not imply that they have been implemented. Task 9's
executable conformance gate is blocked until qualified physical channel
mappings and anatomical ranges are reviewed and collision geometry/policy is
supplied, or the owner explicitly narrows Task 9 to a non-executable scope.
