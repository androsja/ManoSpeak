# Hand Kinematic DSL v3

## Purpose

Motion schema v3 is the strict authoring contract for LSC avatar motion. It
describes the relationship between fingers, palms, wrists, hands, body anchors
and time. It is not consumed by the mobile renderer. A compiler validates and
resolves it to the existing compact motion asset and rig profile.

V2 remains supported and immutable. V3 uses `schemaVersion: 3` and
`kind: "authored-kinematic-motion"`.

## Separation of authority

`linguisticIntent` states what a reviewed LSC sign means: handshape,
orientation, location, movement, manual relations and non-manual markers.
`kinematicRealization` states how the approved intent is performed by a
specific rig. Neither layer may substitute for the other.

Both layers are versioned, hashed and approved before publication.

## Canonical endpoints

All references are closed vocabulary values. They are resolved by the declared
rig profile; free-form bone names and arbitrary coordinate labels are invalid.

```text
hand.<left|right>.<thumb|index|middle|ring|pinky>.<mcp|pip|dip|tip>
hand.<left|right>.palm.<center|thenar|hypothenar|radial|ulnar>
body.<chin|mouth|forehead|chest|shoulder.left|shoulder.right>
```

## Strict JSON shape

```json
{
  "schema": "vozual.motion-schema",
  "schemaVersion": 3,
  "kind": "authored-kinematic-motion",
  "id": "greeting.hello.v1",
  "rig": {"profileId": "vozual-rig-1", "profileRevision": 1, "sha256": "<64-lowercase-hex>"},
  "units": {"length": "m", "angle": "deg", "time": "ms"},
  "linguisticIntent": {
    "language": "lsc-CO",
    "glossSequence": ["ADIÓS"],
    "regionalVariant": "Colombia",
    "phases": [{"id": "stroke", "role": "stroke", "nonManualIds": []}]
  },
  "kinematicRealization": {
    "keyframes": [],
    "contacts": [], "proximities": [], "relativePoses": [],
    "jointRelations": [], "trajectories": [], "transitions": []
  }
}
```

Every keyframe contains both hands. A hand declares `wrist.positionM`, a unit
`wrist.orientationQuat`, and every degree of freedom required by the rig map.
When the pose must preserve an absolute palm direction, the wrist also declares
`orientationSpace: "body-local"` and a unit `palmFacingDirection`. The canonical
body-local axes are X right, Y up, and Z forward toward the viewer.
Finger joints use anatomical names, never opaque XYZ triples: thumb CMC/MCP/IP
have flexion, abduction and twist where supported; other digits have MCP
flexion/abduction/twist plus PIP and DIP flexion.

## Relations

All relation records have unique `id`, `fromMs`, `toMs`, and
`strength: "required" | "preferred"`.

```json
{
  "id": "thumb-index-contact",
  "type": "contact",
  "a": "hand.right.thumb.tip",
  "b": "hand.right.index.tip",
  "fromMs": 280,
  "toMs": 520,
  "strength": "required",
  "maxSeparationM": 0.004,
  "normalAlignmentMin": 0.7
}
```

- `contacts`: endpoint-to-endpoint or hand-to-body touch, allowed surface
  penetration, approach/release requirements and separation tolerance.
- `proximities`: required minimum/maximum distance without claiming contact.
- `relativePoses`: position and orientation of one endpoint in another
  endpoint's local frame.
- `jointRelations`: equality, inequality, range, same-direction, opposed or
  ratio coupling between named anatomical joint metrics.
- `trajectories`: wrist, palm or tip paths with frame of reference, waypoint
  positions/orientations, tolerance, speed, acceleration, jerk and angular
  limits.
- `transitions`: interpolation curve and required C0/C1 continuity between
  keyframes.

## Required semantic validation

JSON Schema validates structure. The compiler additionally samples forward
kinematics at least 120 Hz (or adaptively at every constraint boundary) and
rejects:

1. unknown endpoint, joint, phase or rig reference;
2. non-unit quaternion, time overlap, invalid interval or duplicate ID;
3. a joint outside the rig profile's anatomical range;
4. required contact/proximity/relative-pose tolerance failure at any sample;
5. incompatible simultaneous required constraints or undeclared collision;
6. wrist, palm or tip speed, acceleration, jerk or angular limit violation;
7. discontinuity where a transition requires C0 or C1 continuity;
8. a stroke phase without exactly one kinematic time interval; or
9. a published motion without approved linguistic and technical reviews.

The compiler emits a signed report with worst observed distance, angle, speed,
acceleration and the exact failing sample if validation fails.

## Example: finger proximity and wrist movement

```json
{
  "proximities": [{
    "id": "index-middle-close", "a": "hand.right.index.tip",
    "b": "hand.right.middle.tip", "fromMs": 200, "toMs": 700,
    "strength": "required", "minDistanceM": 0.002, "maxDistanceM": 0.018
  }],
  "jointRelations": [{
    "id": "index-middle-curl", "lhs": "hand.right.index.pip.flexionDeg",
    "relation": "within", "rhs": "hand.right.middle.pip.flexionDeg",
    "toleranceDeg": 12, "fromMs": 200, "toMs": 700, "strength": "preferred"
  }],
  "trajectories": [{
    "id": "right-wrist-stroke", "target": "hand.right.palm.center",
    "space": "body-local", "fromMs": 200, "toMs": 700,
    "maxSpeedMps": 1.2, "maxAccelerationMps2": 5.0,
    "positionToleranceM": 0.008, "curve": "cubic"
  }]
}
```

This is the required authoring language for new reviewed motions. The compiler,
not the WebView, owns conversion to rig bones and avatar profile overrides.

## Stationary-arm wrist movement

A sign that raises an arm and then waves only at the wrist repeats the same
`wrist.positionM` in every wave keyframe and changes only
`wrist.orientationQuat`. For example:

```json
[
  {"id": "raised", "timeMs": 900,
   "wrist": {"positionM": [0.04, 2.4, 0.04],
             "orientationQuat": [0, 0, 0, 1],
             "orientationSpace": "body-local",
             "palmFacingDirection": [0, 0, 1]}},
  {"id": "wave-right-1", "timeMs": 1400,
   "wrist": {"positionM": [0.04, 2.4, 0.04],
             "orientationQuat": [0, 0, 0.382683432, 0.923879533],
             "orientationSpace": "body-local",
             "palmFacingDirection": [0, 0, 1]}},
  {"id": "wave-left-1", "timeMs": 1900,
   "wrist": {"positionM": [0.04, 2.4, 0.04],
             "orientationQuat": [0, 0, -0.382683432, 0.923879533],
             "orientationSpace": "body-local",
             "palmFacingDirection": [0, 0, 1]}},
  {"id": "wave-right-2", "timeMs": 2400,
   "wrist": {"positionM": [0.04, 2.4, 0.04],
             "orientationQuat": [0, 0, 0.382683432, 0.923879533],
             "orientationSpace": "body-local",
             "palmFacingDirection": [0, 0, 1]}},
  {"id": "wave-left-2", "timeMs": 2900,
   "wrist": {"positionM": [0.04, 2.4, 0.04],
             "orientationQuat": [0, 0, -0.382683432, 0.923879533],
             "orientationSpace": "body-local",
             "palmFacingDirection": [0, 0, 1]}}
]
```

The opposite signs in the quaternion Z component encode opposite sides of the
wrist wave. Rotation around body-local Z changes the hand's lateral angle while
the required `[0, 0, 1]` palm direction keeps the palm facing the viewer.

The compiler interpolates translation and orientation independently. The rig
binding sends the unchanged position to the arm IK solver and applies the
changing quaternion to the hand bone. This is a schema-level pattern available
to every sign; runtimes must not branch on a specific gloss to produce it.

## Elbow-driven forearm movement

When a sign moves the complete forearm from the elbow, the hand adds an
independent body-local arm channel:

```json
{
  "arm": {
    "elbow": {"rotationDeg": [0, 0, 10], "space": "body-local"}
  },
  "wrist": {
    "positionM": [0.04, 2.4, 0.04],
    "orientationQuat": [0, 0, 0.130526192, 0.991444861],
    "orientationSpace": "body-local",
    "palmFacingDirection": [0, 0, 1],
    "relativeToForearmDeg": [0, 0, 5]
  }
}
```

The elbow channel rotates the forearm and all its descendants around the elbow
pivot. Wrist orientation remains independently authored, so another sign may
omit `arm` and rotate only the hand. `relativeToForearmDeg` records the wrist
articulation separately; the compiler verifies that composing the 10-degree
elbow rotation with the 5-degree wrist rotation produces the authored
15-degree body-local palm orientation.

## Curved preparation paths and simultaneous expressions

Natural preparation movement uses a palm trajectory instead of assuming a
straight interpolation between the resting and raised keyframes. A midpoint
offset away from the torso creates a smooth raising arc:

```json
{
  "target": "hand.left.palm.center",
  "space": "body-local",
  "fromMs": 0,
  "toMs": 900,
  "path": [
    {"timeMs": 0, "positionM": [0, 0, 0]},
    {"timeMs": 450, "positionM": [0.28, 1.15, 0.05]},
    {"timeMs": 900, "positionM": [0.04, 2.4, 0.04]}
  ],
  "curve": "cubic"
}
```

Non-manual channels run on the same timeline. For example, `"smile": 0.9`
inside a non-manual interval makes the smile explicit for that complete time
range. The compiler samples trajectories and non-manuals together; the runtime
must apply both rather than infer either from the gloss.
