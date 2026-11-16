# Publishable Motion Compilation

`mobile/tools/publishable-motion-pipeline.cjs` is the release-preparation
boundary for authored motion recipes. It does not publish to Firebase or move
a release pointer. It only creates deterministic, content-addressable inputs
for that later operation.

## Pipeline

1. Select a compiler strategy from `schemaVersion` and `kind`.
2. Validate v3 structure, time intervals, quaternions, rig checksum and joint
   limits with the authored kinematic validator.
3. Require an exact registered rig adapter and compatible joint-map revision.
4. Require an approved, dated LSC linguistic review and valid provenance.
5. Refuse any required geometric constraint that the selected rig adapter
   cannot evaluate exactly. The compiler never estimates fingertip geometry,
   contacts, body anchors or trajectories from unspecified rig data.
6. Sample required joint relations and wrist speed at a fixed 120 Hz. A
   relation or declared speed limit violation blocks publication.
7. Compile at a fixed 120 Hz and emit canonical JSON execution-plan bytes, a
   framed `VZKP` motion-binary, and a canonical validation report. Each byte
   sequence has a SHA-256 hash and exact size.

The report intentionally has no clock-generated field. For identical source,
compiler and rig versions, output bytes and hashes are identical.

## Compatibility

The registered `vozual-rig-1` adapter v1 currently maps the authored hand
joint contract but deliberately does **not** claim an endpoint geometry solver.
It can publish only recipes with no required contact, proximity, relative pose
or trajectory constraint. Such a constraint fails with
`KINEMATIC.UNSUPPORTED_REQUIRED_CONSTRAINT`; this is a safety gate, not a
fallback approximation.

V2 is selected as a legacy strategy and structurally validated, but it is not
compiled by this pipeline because a lossless deterministic adapter from its
legacy timeline to the current execution-plan format has not been registered.
It fails with `COMPILER.V2_UNSUPPORTED` after structural validation. The
existing legacy migration workflow remains responsible for immutable v2
artifacts until a reviewed adapter is introduced.

Task 19 consumes the returned artifacts to construct manifests and upload
immutable objects. Mobile download, activation and rendering are outside this
pipeline.
