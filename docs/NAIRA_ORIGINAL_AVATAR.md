# Naira Original Avatar Technical Prototype

## Status and identity

Naira is a new fictional adult character created for Vozual. She does not depict a
real person and does not reuse the topology, textures, proportions or face of the
legacy purchased avatar. The current Task 2 output is a rejected technical prototype,
not a visual candidate or production asset. Human visual review found that it does not
resemble the approved concept closely enough. It must remain outside `mobile/assets`
until a replacement static model passes side-by-side product review, followed by
technical and accessibility review of a versioned export.

Rig, animation and runtime work on Naira are paused. The previous motion preview remains
technical evidence only and must not be used to imply that the character design passed.

The name Naira identifies the character inside the asset pipeline; it does not claim
an ethnicity, community membership or linguistic authority. LSC motion approval is a
separate human-review responsibility.

## Intended visual language

The approved concept defines a non-human humanoid with a deliberately stylized silhouette. She has a
continuous tapered upper torso, pointed ears and a swept crest in teal, indigo and coral.
Her hazel irises always remain inside visible white sclera; dark empty eyes are forbidden.
Visible brows, eyelids, blush, cheeks and coral lips keep the face readable without
photorealism. The design is adult, non-sexualized and free of accessories or visual noise.

The mobile candidate is upper-body only. It has no visible hip, leg, foot or shoe
geometry. The export retains only root/pelvis/spine structural ancestry needed by the
humanoid skeleton, and removes lower-body deform joints. A capped waist produces a clean
mobile crop instead of a visible stump.

The face is built around separate skinned regions for the jaw, lips, cheeks, eyes and
brows. The export contract additionally requires eyelid, eye, jaw, lip and cheek deform
bones, plus the head/neck chain. This supports later facial and head-orientation work;
Task 2 does not claim that final expressions have been authored.

## Signing accessibility

- Bare forearms and hands contrast against both the teal shirt and charcoal background.
- Every finger has three deform segments and the thumb has three segments on each hand.
- Palm segments remain distinct from the wrist so later recipes can express cupping and
  finger spread without treating the hand as one rigid object.
- Neutral review sheets include front and three-quarter views at 1280x720 and the
  smallest supported review viewport, 360x640.
- A 10-second 360x640 H.264 technical preview keeps both hands in frame and demonstrates
  breathing, complete eyelid blinks, micro gaze/head motion, forearm and wrist motion,
  staggered finger closure and a stable return to neutral. It is not an LSC sign.
- No jewelry, patterned sleeve, image texture or loose accessory competes with the hand
  silhouette.

These choices are engineering hypotheses. A human accessibility review on representative
phones remains required before the candidate can become a packaged asset.

## Rejected procedural prototype

`ml/src/blender_build_original_avatar.py` reproduces the rejected technical prototype. Under Blender
5.2.x it generates all geometry from primitives, creates a Rigify control/deform rig,
assigns procedural Principled BSDF materials, saves a `.blend`, exports a neutral GLB,
renders both pose sheets, the technical motion preview and a contact sheet, and writes
SHA-256/byte metadata. It never imports a mesh or an image texture. The approved concept
image is mandatory provenance and is verified against SHA-256
`d1b8a0f71751ab9b96ca8c150c0789b66712e14b624efcbe6babd5a42d64f456`; Blender never
loads, traces or samples it.

Generate a local candidate outside application assets:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python ml/src/blender_build_original_avatar.py -- \
  tmp/avatar-candidates/naira-v2 \
  tmp/avatar-candidates/naira-v2-concept/naira-stylized-concept-v1.png
poetry -C ml run python -m src.avatar_asset_contract \
  ../tmp/avatar-candidates/naira-v2/naira-v2.manifest.json
```

The generated manifest records the builder version, Blender version, Rigify licensing,
procedural provenance, export settings, file sizes and checksums. Generated `.blend`,
`.glb` and PNG files are review evidence and intentionally stay in the gitignored `tmp`
workspace. Only the builder, contract validator, tests and this design record are source
controlled during Task 2. It is not an acceptable final modeling method for the approved
shape language because assembling ellipsoids and generated tube chains does not provide
coherent facial, shoulder, palm or finger topology. The motion audit samples the 30 FPS render at 60 FPS, requires
auto-clamped Bezier curves, quaternion hemisphere continuity, bounded angular velocity
and acceleration, and an identical loop boundary. Human review still owns judgments
about attractiveness, character likeness, penetrations, hand readability and unexpected
volume changes. That review currently fails character likeness.

## Ownership and licence boundary

The procedural character geometry and material choices are project-owned candidate work.
Rigify is the GPL-licensed Blender build tool and its controls are not a runtime asset.
No third-party mesh or texture is incorporated. The manifest keeps
`publicationReviewRequired: true` and `productionReady: false`; promotion requires a new
reviewed export rather than copying the Task 2 candidate into the app.
