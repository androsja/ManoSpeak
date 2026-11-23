# LSC number motion drafts

The editable source for UNO through DIEZ is `number-motion-authoring.json`. Run `npm run generate:number-motion-drafts` from `mobile/` to expand its recipes into frame-based motion JSON and `sign-catalog.json`.

UNO through CINCO follow the numeral descriptions in the [INSOR and Ministry of Education dictionary](https://www.colombiaaprende.edu.co/sites/default/files/files_public/2022-04/Diccionario-lengua-de-senas.pdf). SIETE, OCHO, NUEVE, and DIEZ follow the descriptions on printed pages 157–158. SEIS follows the academic description in [Elementos para una didáctica del lenguaje y las matemáticas en estudiantes sordos de niveles iniciales](../../../../../docs/references/lsc-manuals/README.md). The sources describe hand configurations and actions, not the timing of this avatar prototype or a validated regional performance.

All numerals UNO through DIEZ are authored for the avatar's right hand. The generator mirrors the canonical frame landmarks and side-specific hand profile, so the inactive hand remains at rest while the active right hand performs each sign.

The generator interprets three reusable movement plans:

- `finger-flexion-repetitions` flexes and returns one or more selected fingers together. Its `maintainLateralSpacing` option keeps the moving fingertips evenly spaced as they curl, and `lateralSpacingScale` adjusts how close they sit while bent. NUEVE uses 0.85 to keep its four fingers aligned with a slightly narrower, more natural spread. SEIS uses the index; SIETE, OCHO, and NUEVE use the index and middle, index through ring, and all four long fingers respectively. Their two cycles and timing are prototype choices.
- `arm-translation-repetitions` moves the hand along an authored axis and returns it. Its `translateElbow: false` option holds the elbow still while the wrist and hand move.
- `wrist-rotation-repetitions` rotates the hand landmarks around the forearm axis. DIEZ transitions during frames 0–6 into the mirrored right-hand pose: wrist X/Y/Z 0°/0°/-21°, elbow pivot 12°, horizontal/vertical offsets 0%/0%, forearm axial roll 7°, and palm axial roll 27°. The thumb uses a spatial offset of 0.055 lateral and -0.055 forward while the other fingers remain closed. It then repeats three 45-degree turns. `palmRootScale` widens the wrist-to-knuckle landmark span so the rig does not shrink the fist when its fingers curl. The pose keyframe is authored in JSON and uses the existing runtime editor-pose support.

The renderer uses explicit landmarks for the active right hand and a zeroed landmark block for the resting hand. The avatar finger profile reinforces the authored hand shape. The generator does not add per-sign runtime code: a new sign selects a movement primitive and provides its finger states, location, repetitions, and timing as JSON data. A movement family outside these primitives still needs one reusable generator operation before it can be authored this way.

The numbered JSON files in this folder are local authoring sources. They are not app-bundled release assets; Firebase stores a runtime copy with authoring-only semantic metadata removed. Firebase release v28 updates UNO through DIEZ to use the right hand; unchanged motion and semantic hashes do not prompt existing installs to download them again.

These prototypes are grounded in the cited sources and authorized for project review. That is not professional linguistic or regional validation. Review the avatar playback in Vozual after downloading each release and revise the JSON when the hand shape or movement needs correction.

Regenerate local motion sources from `mobile/` with:

```sh
npm run generate:number-motion-drafts
```
