# Avatar Asset Decision

## Decision

The initial ManoSpeak release will use locally packaged H.264 MP4 avatar clips at 1280x720,
24 frames per second, in a landscape upper-body frame. The source GLB is retained only for
authoring. It will not be bundled in the mobile application.

This route is selected for the first catalogue because it avoids shipping a recoverable
standalone 3D source file, keeps the runtime simple and offline, and permits deliberate
human correction of every LSC motion before release. A runtime 3D renderer remains a later
experiment, not a release dependency.

## Source Asset Audit

The read-only source archives are in `Personaje/1/`. They remain user-owned source material
and are excluded from version control and `mobile/assets/` until a production derivative is
approved.

| Item | Audit result |
| --- | --- |
| Source GLB archive | `Realistic+man_Glb.zip` |
| Uncompressed GLB | 241,791,596 bytes |
| Meshes | 13 |
| Triangles/polygons | 73,102 |
| Vertices | 49,797 |
| Armatures | 1 |
| Bones | 259 |
| Hand/finger bones | 32 |
| Shape-key controls | 798 |
| Imported actions | 6 facial test actions; no approved signing motion |

The rig contains separate hand/finger controls and extensive facial controls. It is therefore
technically suitable for authored LSC animation. Its existing body motion is not a sign
library and must not be presented as one.

## Presentation Profile

- Landscape 16:9 composition, 1280x720 at 24 fps.
- Camera shows head, shoulders, torso, wrists, and both hands/fingers.
- Feet are intentionally outside the normal signing frame.
- Neutral pose and neutral facial expression begin and end each approved clip.
- The final lighting, clothing, background, and skin contrast require accessibility and LSC
  reviewer confirmation before catalogue activation.

## Playback Spike

A Blender workbench render of the profile was encoded locally as H.264 MP4. The one-second
static pipeline check produced a 25,112-byte MP4 with duration 1.000 seconds. This validates
the local render-to-video toolchain only; it is not an LSC sign animation or a quality claim.

## Licence Gate

The download page displayed CGTrader's Royalty Free License with a no-AI designation. Before
shipping, retain the download/transaction record and verify the current licence permits the
specific commercial incorporated-product use. Do not redistribute the downloaded archives or
a readily extractable source derivative. The approved application asset must carry licence
and attribution evidence in the catalogue manifest.

## Next Production Step

After explicit performer consent, record a reference take for `greeting.hello`. Use Blender
to retarget and manually correct hands, wrists, timing, body placement, and non-manual cues.
An LSC reviewer must approve the final clip before it becomes playable.
