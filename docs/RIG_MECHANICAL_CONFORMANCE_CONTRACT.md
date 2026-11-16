# Rig mechanical conformance contract

## Purpose and authority

This Task 3 technical specification describes discrete diagnostic configurations
for the profile-bound candidate. It provides no anatomical joint ranges or LSC
realization approval. The original DWP 3.14 exit condition remains open until a
reviewed specification establishes the required DOFs and limits. This document
does not replace that condition or authorize Task 4.

## Geometric frames

Profile revision 8 contains 171 candidate-bound geometric rest bases in glTF
right-handed Y-up coordinates. Their validation checks inventory count,
digest, unit length, orthogonality and handedness. These world-oriented rest
bases must not be substituted directly for the local Euler command axes.

## Local-axis response and skin deformation

On the exact revision-8 candidate, `measure-rig-palm-axis-probes.py` measured
the signed motion of 30 digit-bone tails under isolated local X/Y/Z +/-10-degree
rotations. Two Blender 5.2.3 runs were byte-identical. Every local-Y tail probe
had zero endpoint displacement, consistent with rotation about the bone's
longitudinal direction; this does not mean the axis is locked or has no effect
on the skinned surface.

`measure-rig-per-bone-skin-response.py` separately measures NUG_Base_Body
vertices with positive weight for each probed bone. Two runs of its 180 signed
samples were byte-identical, and all 30 bones showed nonzero weighted-skin
response on local Y. For +/-10 degrees, maximum per-vertex displacement on Y
ranged from 0.00109041 m to 0.003774977 m. Bone-tail motion alone therefore
misses some axial skin deformation. These are geometric observations for one
mesh and one candidate; they do not assign anatomical semantics, establish
safe limits, validate coupled poses, or authorize use of each axis.

`audit-rig-coupled-probes.py` also sampled 600 exact two-command snapshots at
plus/minus 10 degrees on this candidate: 360 same-bone different-axis pairs
and 240 same-axis pairs across adjacent segments. The scoped dominant-weight
BVH checker found overlaps in 118 same-bone pairs and 62 adjacent-segment
pairs. In particular, local-Z rotations of adjacent left-index segments at
-10/-10 degrees produced 234 triangle-pair overlaps. These discrete results
show why separate single-axis passes cannot be composed into a safe domain.
They do not exhaust coupled configurations or certify paths. The compiler
continues to reject arbitrary multi-axis and multi-bone requests.
Comparing those 600 pair results with their 180 individual +/-10-degree
samples found 16 pair poses with zero scoped overlaps even though at least one
component probe overlapped in isolation (for example, left thumb.01 X +10
degrees alone had 22 overlaps; adding local Y -10 degrees on that same bone
had zero in the pair sample). This limited non-monotonic result confirms that
single-axis samples cannot be treated as independent joint-limit components.

## Mechanical diagnostic domain

`rig-mechanical-conformance.cjs` derives a canonical contract from the validated
profile. Its digest binds the profile digest, candidate digest, representation,
reset rule and complete configurations. Each command is a rest-relative local
Euler XYZ vector in radians. Every probe resets every bone to profile rest;
unlisted bones keep identity local transforms.

The base domain contains two complete configurations:

| Configuration | Local rotations |
| --- | --- |
| `neutral-rest` | All bones at rest |
| `left-index-curl-v1` | Left index segments 01/02/03: respectively `[0.15,0,0]`, `[0.20,0,0]`, `[0.15,0,0]`; other bones at rest |

For profile revision 8 SHA `c8d77d81161fcc70a6340637c3eb3635e26ce231a16afcddf941f5e9317eec8d`
bound to candidate SHA `748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a`,
two further complete diagnostic configurations are available:
`corrected-hand-diagnostic-left-v1` and `corrected-hand-diagnostic-right-v1`.
Each rotates the 15 named bones of one hand locally: flexion-axis X values
`[0.15,0.20,0.15]` radians per digit; proximal middle/ring Z rotations are
oppositely signed at magnitude `0.025` radians, mirrored between hands. The
proximal thumb Z is `+0.2` radians left and `-0.1` right. All other bones are
at rest. Their exact values and bone IDs are validated against the inventory.
The observations are geometric diagnostics, not anatomical sign semantics.

The index configuration is derived from the profile's calibrated endpoint
commands. Those values are diagnostic samples, not independent axis limits.
Changing one angle, adding a rotation, omitting a listed bone, or requesting a
different pose is outside the supported diagnostic domain. No interval,
interpolation, composition, transition or anatomical DOF is implied.

## Compiler enforcement

The restricted v4 conformance compiler accepts
`constraints.mechanicalPoseProbes` entries containing exactly `poseId` and
`rotationCommandsRad`. It requires exact configuration equality, adds the
`endpoint.pointAnchors` capability requirement and validates profile/candidate
binding before accepting probes. Its optional diagnostic output contains the
contract digest and accepted IDs. Duration remains zero and frames remain
empty. It does not execute or compile motion trajectories.

Unknown constraints and nonempty `rigRealizationOverrides` are rejected with
`COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY`; malformed probes are rejected with
`SCHEMA.UNSUPPORTED_VERSION`. Runtime playback of arbitrary mechanical poses
remains unsupported. Compiler build `task3-rig-conformance-5` retains the
candidate-bound configurations and adds the isolated diagnostic catalog below;
historical build-1 through build-4 artifacts retain their original meaning.
The build emits no motion frames.

## Isolated measured diagnostics

`schemas/rig-profiles/vozual-rig-1.isolated-probes.v2.json` records 1,710
discrete measurements on the exact revision-8 candidate. Its canonical digest
is pinned to `47fc522add7cd0a43ca20ec633e02cbbd5de3d9dcc3bfcb1eda93a711653bc50`.
It merges 1,530 dense samples from `TASK_3_PER_BONE_DENSE.json` with 180 exact
signed +/-10-degree samples from `TASK_3_PER_BONE_COLLISION_PM10_BUILD4.json`.
Each probe resets the rig and rotates exactly one bone about one axis at an
exact measured angle.
The compiler accepts `isolated-bone-probe-v1` only for a measured nonzero
sample with zero detected overlaps in the stated scoped test. A measured
collision is rejected with `KINEMATIC.DIAGNOSTIC_COLLISION` and its count;
unmeasured angles, other rigs, and multiple simultaneous axes or bones fail
closed. Neutral rest uses the separate `neutral-rest` pose.

Zero detected overlaps is a narrow diagnostic observation. It does not imply
an anatomical-safe joint limit, interpolation, coupled-motion support, full
mesh collision freedom, or permission to execute a general v4 motion.

The merged catalog matches every source angle and overlap count. Of 1,710 rows,
90 zero-angle records remain represented by neutral rest; among 1,620 nonzero
samples, the compiler accepts 1,385 with zero scoped overlaps and rejects 235
measured collisions with their recorded count. The +/-10-degree collision
survey alone finds 34 colliding and 146 zero-overlap samples. The catalog's
canonical SHA-256 is checked against a pinned digest and exact profile/candidate
hashes, including when the broader corrected-hand diagnostic contract is
built. These counts describe tested samples, not supported joint ranges.

## Verification and scope

`verify-rig-mechanical-conformance.py` imports the exact candidate, dirties all
171 local rotations, resets them and applies each complete configuration twice.
It checks each local rotation and identical evaluated bone matrices on replay.
`measure-rig-coordinate-contract.py` separately compares the calibrated endpoint
with its profile target: 0.015 m position and 4 degrees orientation tolerances.
`verify-rig-finger-intersections.py` checks the scoped skin rest-digit and
left-index pose surfaces. Its exclusions remain applicable: this is not a
whole-body collision guarantee, source/export skin parity proof for this exact
index configuration, or anatomical validation.

Technical review and local verification are performed by the implementing
agent. No independent reviewer or anatomical reviewer approval is recorded.

## Remaining 3.14 work

An actual DOF/range specification must declare bone mapping, coordinate
conventions, coupled joints, allowed domains, evidence provenance and review.
Continuous ranges require coverage beyond isolated samples; independent axis
ranges cannot imply that every combined rotation is valid. The profile's
`degreesOfFreedom` and `jointLimits` remain `unsupported` until that work is
validated and bound to the asset. A future DWP refinement may separate geometric,
mechanical and anatomical acceptance, but must preserve the old condition and
explicitly record any deferred requirement.

## Authored JSON limit envelope (v3 only)

The repository also contains a separate v1 rig profile used by the authored
kinematic JSON compiler. Its twelve `jointLimitsDeg` entries are mirrored in
`schemas/rig-profiles/vozual-rig-1.mechanical-limits.v1.json`, whose envelope
SHA is `abf385b6766042d784889715ebfd22043b943de23d6f5614194ce06ccf9f0a30`. 
The source profile is bound by raw SHA
`213258754b05d79d1000ca9bcadf4687c82221d4d800c75c2d1f3eacfcaf3129` and
declared profile SHA `c1b1eeeaa590549243d0d3aaafa60f8abeb92af7a6a872003862771332fe142f`.

This envelope is a declared mechanical authoring range for
`mobile/assets/motions/*.motion.v3.json`. `kinematic-motion-v3.cjs` checks the
exact profile hash and rejects missing or out-of-range values with
`KINEMATIC.RIG_LIMIT` or `KINEMATIC.JOINT_LIMIT`; elbow components are bounded
to `[-180,180]` degrees and wrist-relative components to `[-90,90]` degrees.
The current `adios.motion.v3.json` (raw SHA
`09614e07479c08b863a6ddf4b02d770b85d0b9b97cedd7aaf0148196e1244507`) passes
these checks.

The envelope is deliberately not called anatomical or safe. It is not yet
mapped to the 171-bone v2 capability profile, does not prove coupled
collision-free configurations, and is not enforced by the 80 compact legacy
motion files, which use normalized finger values and configured curls. The
restricted v4 compiler also remains a conformance compiler: it rejects
non-empty temporal motion graphs and does not execute arbitrary JSON motion.
The literal exit condition requires a reviewed anatomical/rig specification;
it does not itself mandate an external human reviewer. Earlier conversation
and checkpoint wording overstated that requirement. Implementing-agent
technical review can establish reproducible mechanical evidence. Anatomical
claims and human LSC acceptance require their own supporting evidence and
must not be inferred from this audit.

## Command-axis review and versioned remediation

`mobile/tools/audit-rig-command-axes.cjs` checks the exact profile and candidate
hashes before inspecting the raw glTF nodes. It selects the 30 digit bones
already declared in the profile inventory and follows their explicit parent
links. For 20 nonterminal bones it measures isolated 10-degree local X/Y/Z
rotations using the direct child's rest offset. The 10 terminal bones remain
unmeasured by this method; it does not invent tail endpoints.

Two runs on the revision-8 candidate produced byte-identical reports, SHA-256
`99e43afd9b317205fce5ede4060c61db12b6343e20a02573b54cdd73396bf716`.
All 20 measured offsets align with local Y within the declared 0.99999 dot
threshold. Thus Y is the measured longitudinal rotation axis, and X/Z are
transverse geometric directions. The frozen v3 adapter labels Y as abduction
and Z as twist; these labels cannot be transferred unchanged as anatomical
DOFs into the v2 descriptor. In the left index proximal segment, the isolated
10-degree Y command moves the direct child by approximately 2.315e-8 m while
the Z command moves it by 0.00612845 m.

This audit determines axial versus transverse response, not the signed
flexion/spread basis or a permissible rotation interval. A blanket Y/Z swap
is not a reviewed mapping, especially for the thumb.

Remediation sequence under 3.14:

1. Measure signed flexion and spread directions against each calibrated palm
   frame and independently measure terminal endpoints, including both thumbs.
2. Record per-bone rest-relative axes, units, rotation order, locked commands,
   coupled-domain rules, and measured mechanical limits in a versioned v4 rig
   specification. Unmeasured domains remain unsupported.
3. Validate boundary and intermediate coupled poses on the exact candidate,
   with endpoint and collision tolerances, before declaring the corresponding
   v2 capabilities supported. Preserve the frozen v3 mapping and golden plans.

The new audit is a diagnostic tool, not an integrated motion compiler or a
joint-limit enforcement path. Subtask 3.14 remains partial under its existing
exit condition. Human linguistic acceptance is a separate later gate.
