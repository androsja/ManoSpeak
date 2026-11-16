# ADIÓS kinematic milestone

This milestone proves the complete authoring-to-playback path for one sign:

```text
ADIÓS authored JSON → schema and rig validation → deterministic 120 Hz plan
→ WebView bone playback
```

The source fixture is `mobile/assets/motions/adios.motion.v3.json`. It uses
`vozual.motion-schema` version 3 and keeps the semantic intent separate from
the kinematic realization. Every keyframe contains both hands, a wrist pose,
and all 15 finger joints per hand. The active hand also declares an optional
body-local elbow rotation. The timeline declares the non-manual face controls
and the transitions between keyframes.

The top-level `revision` field is the official integer version of the sign.
Every authored JSON change must increment it by exactly one. The compiler
copies it into `plan.source.revision`, allowing diagnostics and artifacts to
identify the exact motion revision that was executed.

The runtime plan is generated during `npm run build:avatar-runtime` by
`mobile/tools/compile-authored-motion.cjs`. The compiler samples the source at
120 Hz and writes `adios.runtime-plan.json` into the WebView asset directory.
The avatar then reads the plan when `ADIOS` is requested in rigged mode and
applies the elbow rotation, wrist orientation, wrist displacement, finger
rotations, gaze, head, mouth and brow controls for each sampled frame.

The active left hand follows a required three-point cubic trajectory from rest
to the greeting height, producing a small outward raising arc. The authored
IK anchor then remains fixed while the forearm alternates +10 and -10 degrees
around the elbow pivot. The wrist adds a small relative +5/-5 degree movement,
so the visible hand reaches +15/-15 degrees while the palm remains forward.
The generic wrist-only channel remains available to signs that require it. A
strong authored smile (`0.9`) remains active over the complete sign timeline.

Run the focused proof from `mobile/`:

```bash
npm install
node tools/compile-authored-motion.cjs \
  --input assets/motions/adios.motion.v3.json \
  --profile ../schemas/rig-profiles/vozual-rig-1.v1.json \
  --sample-rate 120 \
  --output /tmp/adios.runtime-plan.json
npm test -- --runInBand tools/__tests__/kinematic-motion-v3.test.ts tools/__tests__/compile-kinematic-motion-v3.test.ts
npm run build:avatar-runtime
```

This is a technical playback proof, not linguistic approval. The source file
is intentionally marked `linguisticReview.status: "draft"`; it must not be
published as an approved LSC sign until a qualified reviewer validates the
movement.
