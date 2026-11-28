# Authored courtesy drafts

GRACIAS is procedurally authored. The editable files in this folder retain draft status; the owner-approved publication copy is `../../gracias.motion.json`. The owner approved the web preview and explicitly requested publication on 2026-11-26. The source is the INSOR / Instituto Caro y Cuervo *Diccionario básico de la lengua de señas colombiana*, printed page 485 (PDF page 537 in the repository copy). Its manual sequence starts with the dominant fingertips at the chin, palm facing the signer, then moves to the opposite palm with a small head inclination. No video, recorded landmarks, or previous GRACIAS motion is used to generate this draft.

Edit `gracias.authoring.json`, then run from `mobile/`:

```sh
node tools/generate-gracias-motion-draft.cjs
npm run pose:reference
```

Open <http://127.0.0.1:4175/hand-pose-reference?gloss=GRACIAS&draft=1>. The existing preview offers playback, millisecond seeking, both hand controls, and the formatted motion JSON. The recipe uses normalized body coordinates; head pitch is in radians. The runtime interpolates 73 frames over 2400 ms. Chin contact holds at 700–900 ms, opposite-palm contact at 1400–1600 ms, then both hands return to rest. The right hand starts and finishes against the dress at the abdomen, palm facing the torso and fingers diagonally downward. An explicit across-palm direction rotates smoothly during the ascent while preserving the approved chin contact. The left support palm faces upward throughout. These timings and geometric choices are an authored interpretation for review, not measurements of a signer.

The creator preview installs the JSON through `installVozualMotionJson`, matching the mobile JSON playback path. The shared runtime now preserves explicit `headOrientation` without requiring captured facial landmarks. A mobile runtime rebuild is required to include that head-orientation correction before publishing this draft for mobile users.

Measured gzip level 9 payloads: old local GRACIAS 510,999 bytes; authored draft 20,751 bytes (95.9% reduction). This compares motion files, not total application or speech-model downloads.

Review the hand orientation, both contacts, finger spacing and nod in the web before approving. Publication requires the approved-sign workflow and an explicitly published immutable JSON release. The approved copy is included in the 12-sign publication catalog; its release retains HOLA and numerals 1–10. The editable recipe remains available for future local review.

## PERDÓN

`perdon.authoring.json` defines the owner-requested PERDÓN draft (owner visual review 2026-11-26; INSOR p.491 two-hand variant was rejected). The dominant right hand closes into a fist (all fingers including thumb closed, palm toward chest), rises from the abdomen rest position, crosses to the avatar's left pectoral (opposite chest side, x ≈ 0.61), and traces two small clockwise circles (radius ≈ 0.045 vertical / 0.038 depth) in the chest plane over 36 frames. The hand then returns smoothly to the abdomen rest. The left hand remains inactive (all-zero slots). Timing and avatar geometry are authored choices awaiting visual review.

Regenerate with `node tools/generate-perdon-motion-draft.cjs` from `mobile/`. Open <http://127.0.0.1:4175/hand-pose-reference?gloss=PERD%C3%93N&draft=1>.

## BUENAS NOCHES

`buenas-noches.authoring.json` defines a local procedural draft based on INSOR's dictionary, printed page 486 (PDF page 538). First the right fingertips contact the chin (550–700 ms) and then the opposite palm (1050–1200 ms). Both hands rise open with palms facing inward, cross while closing (1550–2050 ms), hold with the fists centered at the chest, right in front and left slightly higher, until 2400 ms, and return to rest by 3000 ms. Total timeline: 3200 ms / 97 frames at 30 FPS. Timing and coordinates are authored choices pending owner visual review.

Regenerate from `mobile/` with `node tools/generate-buenas-noches-motion-draft.cjs`. This reuses the analytic greeting frame builder and contact profile, with sign-specific crossing and closing controls. No captured video landmarks are read. Gzip level 9 payload: 26,934 bytes. Open <http://127.0.0.1:4175/hand-pose-reference?gloss=BUENAS+NOCHES&draft=1> to prepare the existing avatar preview, timeline, and formatted JSON view. Firebase and the released sign catalog are unchanged.

## QUERER

`querer.authoring.json` defines a local procedural draft based on INSOR's dictionary, printed page 266 (PDF page 318), refined per owner visual review (`2026-11-27`) using a continuous Hermite spline (`zero pauses`) so both open '5' hands lift smoothly from rest through a low palms-up forward pass (`~500 ms`), rise into a wide-open spider shape at the chest (`~967 ms`), and descend clearly (`y = 0.89 → 1.045`) while closing the fingers further (`~1467–1567 ms`, `48` frames at 30 FPS) as the sign completes, leaving phrase continuation and IDLE return to the runtime. Timing, coordinates, and curl profile are authored choices pending owner visual review.

Regenerate from `mobile/` with `node tools/generate-querer-motion-draft.cjs`. Open <http://127.0.0.1:4175/hand-pose-reference?gloss=QUERER&draft=1> to review the 3D avatar preview, timeline, and formatted JSON. Firebase and the released sign catalog are unchanged.
