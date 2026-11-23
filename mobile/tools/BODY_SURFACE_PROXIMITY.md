# Measured body-surface proximity diagnostics

`compileV4RigConformanceRecipe` accepts `constraints.bodySurfaceProximities`
in a v4 `rig-conformance` recipe. The example in
`schemas/fixtures/rig-conformance-v4/body-surface-proximity.json` evaluates both
index tips at three measured poses. Each constraint accepts the following fields.

| Field | Contract |
| --- | --- |
| `id` | Nonempty ID, unique within this constraint family |
| `anchorId` | `hand.index.tip.left` or `hand.index.tip.right` |
| `surfaceId` | `torso-dominant-v1` |
| `frameId` | `body` |
| `minDistanceM`, `maxDistanceM` | Finite, nonnegative inclusive bounds, minimum no larger than maximum |
| `samples` | Nonempty list of `{timeMs, poseId}`; strictly increasing nonnegative safe integer times |
| `surfacePolicy` (optional) | Object with `minApproachNormalDot` in [−1, 1] and `collisionPriority` equal to `required` or `preferred` |

The measured poses are `neutral-rest`, `bilateral-index-approach`, and
`right-index-middle-overlap`. An unsupported pose rejects with
`KINEMATIC.BODY_SURFACE_PROXIMITY_EVIDENCE_UNAVAILABLE`. An out-of-range sample
rejects with `KINEMATIC.BODY_SURFACE_PROXIMITY_OUTSIDE_RANGE`; malformed or
unsupported fields reject with `SCHEMA.INVALID_BODY_SURFACE_PROXIMITY`.
All supplied samples are evaluated; there is no interpolation between them.

The compiler reconstructs the endpoints using calibrated forward kinematics,
checks them and their distance to the measured surface point within one
micrometer of the pinned Blender observations, and evaluates the requested
range against the reconstructed distance. It reports every sample and the
sample with the greatest violation of either bound; ties select the first
sample. A passing range has zero violation and selects its first sample.
The raw measured triangle normal, triangle index, mask description and evidence
SHA-256 are included for provenance. Requested bounds are author constraints,
not measured safety thresholds.

The source evidence file
`schemas/rig-profiles/vozual-rig-1.body-surface-proximity-evidence.v1.json`
is an exact-byte copy of the already verified Task 7 multi-pose measurement
output, SHA-256
`895d9d616fdfd934c2b295948a284e76b37fb06d6520facd289be6edb79159c2`.
The compiler pins those bytes and binds their candidate, profile and calibration
identities. The original report and repeat output remain under the local plan's
`analysis_results/task7_multi_pose_body_surface_measurements_20261120/`.
No measurements were regenerated for this integration.

Distance is relative to the torso-dominant triangle mask with the leg material
excluded. Distance-only constraints report `collisionEvaluation: not-performed`.
Recipes containing only the original proximity checks use compiler build
`task7-body-surface-proximity-1`.

## Optional sampled surface policy

When a constraint requests `surfacePolicy`, the compiler reconstructs the
same-side index root and tip at each requested pose. It evaluates the dot
product of the unit root-to-tip axis with the negated unit normal of that tip's
nearest recorded torso triangle. A dot of +1 indicates alignment toward the
surface along the inward normal. The minimum is inclusive. The smallest dot
is reported as `worstAlignment`. Missing poses reject.

For each sample the compiler reads the intersection count between the selected
hand and the torso mask, excluding triangles that share vertices. The largest
count is reported as `worstOverlap`. A positive count rejects a required
collision constraint. With preferred priority the diagnostic records
`collisionSatisfied: false`. Distance and alignment thresholds remain mandatory
with either collision priority. A tie selects the earliest supplied sample.

Recipes using the policy carry build `task7-body-surface-proximity-2` and
emit zero motion frames. The evaluation covers discrete hand-to-torso surface
samples. Finger self-intersection, penetration volume, motion between samples,
physical contact, anatomy and visibility are outside its scope.
