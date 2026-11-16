# Avatar Authoring and Runtime Decision

## Status

Accepted on 2026-11-01. This decision supersedes the earlier MP4-only release decision.

The repository already ships a Three.js/WebView avatar runtime and a rigged GLB. Treating
the GLB as authoring-only no longer describes the implementation. Approved H.264 clips
remain a fallback, not the canonical source and not the only playback path.

## Decision

Vozual will use four separate layers:

1. An optional capture layer containing private observation evidence such as MediaPipe
   landmarks. Capture is never the linguistic authority.
2. A versioned JSON authoring recipe containing explicit body, hand, finger, palm,
   timing, contact, trajectory and non-manual channels. The approved recipe is the
   canonical source.
3. Avatar-specific presentation corrections bound to the recipe and avatar profile by
   hashes. Corrections cannot silently replace linguistic motion.
4. A deterministic compact binary compiled from the approved recipe for mobile playback.

Firebase may hold the canonical approved recipe, its review/provenance metadata and the
compiled cache. Mobile clients should download the compact cache after validating size,
SHA-256, compiler version, avatar profile and publication state. JSON is the authoring
language; binary is the delivery format. JSON is not assumed to be smaller merely because
it is JSON.

The primary renderer is real-time 3D on devices that satisfy the gates below. An approved
1280x720 H.264 clip is used when the device cannot satisfy the 3D gate, the GLB fails
integrity or compatibility checks, or a reviewed motion does not yet have a safe runtime
representation. The fallback must represent the same approved recipe and review revision.

Existing `motion-json-v1` and VZMB resources remain playable as legacy versions. They are
not deleted or automatically promoted to the new contract. Migration is sign-by-sign and
must not infer missing palm orientation, finger articulation, time or non-manual markers.

## Authoring Rig Decision

Blender 5.2.3 LTS and Rigify are the production baseline. The control rig is an authoring
tool; only a stable deform skeleton, baked local transforms and supported morph targets
may be exported to glTF/GLB.

CloudRig 2.2.31 was also tested from the official Blender Extensions package in an isolated
temporary profile. Both systems generated a human rig, accepted an IK hand edit, baked the
result, exported GLB and reproduced the tested deform transform after reimport with a
maximum matrix-component error of `3e-7`.

| Spike | Authoring bones | Deform bones | Constraints | Exported GLB | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Rigify | 706 | 160 | 533 | 163,976 bytes | Selected |
| CloudRig 2.2.31 | 474 | 71 | 345 | 76,536 bytes | Compatible, not selected now |

CloudRig is not rejected for Blender incompatibility. It is deferred because its deform
names and segmentation do not match the current `1_Rigify`/`DEF-*` runtime mapping, and it
has not yet been compared on the production mesh with the same LSC motion and weights.
Rigify minimizes integration risk and already matches the current asset family. Any future
CloudRig trial must use a versioned skeleton adapter and pass the same pose, deformation,
mobile and linguistic gates.

Neither rig's constraints are a runtime contract. Blender emitted constraint-bake warnings
for both spikes, so export must explicitly bake visual transforms and verify a fresh GLB
reimport. Widgets, metarigs, mechanism bones and control bones must not be exported.

Primary CloudRig evidence:

- [CloudRig on Blender Extensions](https://extensions.blender.org/add-ons/cloudrig/)
- [CloudRig source repository](https://projects.blender.org/Mets/CloudRig)
- [Blender extension command-line documentation](https://docs.blender.org/manual/en/4.5/advanced/command_line/extension_arguments.html)

## Current Baseline

### Motion signals

The current source format stores one FPS value plus per-frame XYZ coordinates for 33 pose,
21 left-hand, 21 right-hand and 468 face landmarks. The compact VZMB format quantizes the
same 543 points to signed 16-bit coordinates.

| Signal | Source JSON v1 | VZMB/mobile | Current loss or derivation |
| --- | --- | --- | --- |
| Frame count and nominal FPS | Preserved | Preserved | Original per-frame timestamps are absent. |
| 33 body points XYZ | Preserved | Quantized | No authored joint rotations, contacts or confidence. |
| 21 points per hand XYZ | Preserved | Quantized | Palm and bone rotations are derived at runtime. |
| Individual finger articulation | Observed as landmarks | Derived | No explicit 15-bone authored contract or anatomical limits. |
| Palm orientation | Optional profile label | Not a binary channel | Reconstructed from landmarks and per-sign overrides. |
| 468 face points XYZ | Preserved | Quantized | Runtime selects/derives a smaller expression set. |
| Head orientation | Optional in the TypeScript in-memory type | Not serialized by VZMB | Derived from face landmarks when available. |
| Gaze, eyelids, brows and mouth intent | Not explicit | Derived | Neutral and missing values can be indistinguishable. |
| Contacts, trajectories and interpolation | Partial profile metadata | Not first-class channels | Implemented by runtime heuristics and overrides. |
| Confidence, missing groups and source timestamps | Not preserved | Not preserved | Zero points represent missing groups. |

This is sufficient for legacy playback, but not for deterministic written authoring. The
new recipe must use one authority per signal: keyframe time, wrist position, palm
quaternion, 15 local finger-bone rotations per hand, explicit body state and explicit
non-manual state. The optional 21-point hand capture remains evidence only.

### Assets and catalogue

| Baseline measurement | Result |
| --- | ---: |
| Source motion files | 80 |
| Source motion JSON total | 99,445,447 bytes (94.84 MiB) |
| Published subset | 25 signs |
| Published source JSON | 29,133,759 bytes (27.78 MiB) |
| Published compact VZMB total | 2,880,472 bytes (2.75 MiB) |
| Published Base64 total | 3,840,696 characters/bytes (3.66 MiB) |
| Largest current per-sign Base64 payload | 234,600 characters |
| First 12 decoded motions, Node heap proxy | 19,108,568 bytes (18.22 MiB) |

The compact published subset is about one tenth of its captured JSON input. Base64 adds
approximately 33.34% to the raw binary. The 12-motion heap figure is a conservative desktop
Node proxy for 431 decoded frames; it is not a substitute for release-device WebView memory.

The currently loaded `vozual_woman_avatar.glb` has 171 deform bones, eight meshes, no
actions and is 11,268,796 bytes. The repository also contains experimental variants and a
77,530,820-byte legacy avatar. The runtime loads the base GLB rather than the `hands_v4`
variant. Asset selection must become manifest-driven instead of filename-dependent.

The current rig contains complete finger and facial bone chains, but no exported control
constraints, actions or shape keys. The runtime therefore performs substantial retargeting
and presentation work in TypeScript. Control-rig quality cannot be inferred from the GLB;
it must be tested in the Blender source and after bake/export.

## Initial Acceptance Budgets

These are versioned engineering gates, not claims that the current application already
passes. Device metrics remain `UNKNOWN` until measured in a release build on physical
Android and iOS target devices.

### Motion fidelity and deformation

| Metric | Target | Failure gate |
| --- | ---: | ---: |
| Wrist/hand position, recipe to Blender/mobile | <= 1.5 cm | > 2.0 cm |
| Palm orientation | <= 4 degrees | > 5 degrees |
| Finger local rotation | <= 4 degrees | > 5 degrees |
| Head orientation | <= 4 degrees | > 5 degrees |
| Timing and channel synchronization at 30 FPS | <= 1 frame (33.34 ms) | > 1 frame |
| Declared contact separation | <= 1.0 cm | > 1.5 cm |
| Bake/export matrix-component error | <= 1e-5 | > 1e-4 |
| Pose volume loss against neutral region | <= 8% | > 10% |
| Visible self-intersections, normal inversions or elbow flips | 0 approved poses | Any approved pose |

Volume is measured on named mesh regions in a fixed golden pose suite, not by subjective
inspection alone. The golden suite includes neutral, open palm, fist, index, pinch, crossed
thumb, wrist limits, arm reach and combined wrist/finger poses from front, side and oblique
views.

### Runtime and delivery

| Metric | Target | Failure gate |
| --- | ---: | ---: |
| Avatar GLB, including textures | <= 12 MiB | > 20 MiB |
| Exported deform bones | <= 180 | > 200 |
| Compiled motion per sign | <= 256 KiB | Base64 >= 900,000 characters |
| Decoded 12-motion cache component | <= 24 MiB | > 40 MiB |
| 3D playback rate | >= 30 FPS | < 24 FPS sustained |
| Motion start after local cache hit, p95 | <= 100 ms | > 150 ms |
| Cold GLB ready time, p95 | <= 2.0 s | > 3.0 s |
| Total peak app memory | <= 150 MiB | > 200 MiB |

The GLB, motion-start and cache limits are initial avatar-specific hypotheses. The total
memory gate remains aligned with `PERFORMANCE.md`. A device that misses a hard 3D gate must
use the reviewed baked fallback rather than degrading anatomy or omitting channels.

## Licence, Provenance and Privacy Gates

- The production character must be a new fictional work with a recorded source manifest,
  checksums, tool versions and licence. A generated concept image is reference material,
  not production topology or a production texture.
- The previous CGTrader source has a no-AI designation and unresolved incorporated-product
  evidence. It remains legacy user-owned source material and is not the basis for the new
  character.
- Bibliographic sign descriptions require source, region, usage permission and reviewer
  traceability. A technical compiler cannot grant linguistic approval.
- Performer video, camera frames and raw landmarks stay local and private by default.
  Upload requires explicit consent and a new privacy review. Approved recipes contain no
  raw image or audio.
- Firebase publication requires recipe and compiler versions, avatar profile, SHA-256,
  byte size, licence/provenance state, technical approval and human LSC approval.
- No automatic process may invent a missing sign, orientation, articulation, trajectory,
  timing or non-manual marker. Missing required data blocks publication.

## Validation Baseline

The Task 1 audit ran the relevant local gates before this decision:

- Mobile targeted suites: 4 suites and 89 tests passed.
- Mobile TypeScript typecheck passed.
- Mobile ESLint completed with zero errors and 55 existing warnings.
- ML pytest: 160 tests passed with two warnings.
- ML Ruff passed.
- ML mypy was executed and exposed existing package discovery/type debt: duplicate
  `export_onnx` module discovery; enabling explicit package bases reveals approximately
  282 pre-existing typing errors. No mypy configuration was changed in this task.
- Blender 5.2.3 LTS passed headless startup, isolated Rigify generation/export/reimport and
  isolated CloudRig generation/export/reimport.

This decision changes documentation and architecture boundaries, not a serialized runtime
contract. Contract implementation and automated parity tests belong to Tasks 3, 5, 6 and 8.

## Consequences

- Captured landmark files can remain as migration evidence, but new signs can be authored
  completely without video.
- The mobile app receives a smaller deterministic representation and does not need to
  download source video or dense capture JSON.
- Rig and recipe correctness are separate from linguistic correctness. Automation may
  reject technical defects, but only an LSC-qualified human reviewer may approve meaning,
  regional use, grammar and non-manual behavior.
- The original avatar, skeleton mapping, compiler and mobile runtime must evolve together
  through versioned manifests and golden fixtures. Filename replacement is not a migration.
