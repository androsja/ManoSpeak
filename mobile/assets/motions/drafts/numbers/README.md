# LSC number motion drafts

The editable source for UNO through DIEZ is `number-motion-authoring.json`. Run `npm run generate:number-motion-drafts` from `mobile/` to expand its recipes into frame-based motion JSON and `sign-catalog.json`.

UNO through CINCO follow the numeral descriptions in the [INSOR and Ministry of Education dictionary](https://www.colombiaaprende.edu.co/sites/default/files/files_public/2022-04/Diccionario-lengua-de-senas.pdf). SIETE, OCHO, NUEVE, and DIEZ follow the descriptions on printed pages 157–158. SEIS follows the academic description in [Elementos para una didáctica del lenguaje y las matemáticas en estudiantes sordos de niveles iniciales](../../../../../docs/references/lsc-manuals/README.md). The sources describe hand configurations and actions, not the timing of this avatar prototype or a validated regional performance.

The generator interprets two reusable movement plans:

- `finger-flexion-repetitions` flexes and returns one or more selected fingers together. Its `maintainLateralSpacing` option keeps the moving fingertips evenly spaced as they curl, and `lateralSpacingScale` adjusts how close they sit while bent. NUEVE uses 0.85 to keep its four fingers aligned with a slightly narrower, more natural spread. SEIS uses the index; SIETE, OCHO, and NUEVE use the index and middle, index through ring, and all four long fingers respectively. Their two cycles and timing are prototype choices.
- `arm-translation-repetitions` moves the hand along an authored axis and returns it. DIEZ uses this for the dictionary's inward/outward motion. Its position, palm rotation, distance, and timing are avatar approximations.

The renderer uses explicit landmarks for the active left hand and a zeroed landmark block for the resting hand. The avatar finger profile reinforces the authored hand shape. The generator does not add per-sign runtime code: a new sign selects a movement primitive and provides its finger states, location, repetitions, and timing as JSON data. A movement family outside these primitives still needs one reusable generator operation before it can be authored this way.

The numbered JSON files in this folder are local authoring sources. They are not app-bundled release assets; Firebase stores a runtime copy with authoring-only semantic metadata removed. Firebase release v14 contains ADIÓS and UNO through DIEZ; v14 updates only NUEVE. Each release includes existing signs as well as new signs so that the active catalog remains complete; unchanged motion and semantic hashes do not prompt existing installs to download them again.

These prototypes are grounded in the cited sources and authorized for project review. That is not professional linguistic or regional validation. Review the avatar playback in Vozual after downloading each release and revise the JSON when the hand shape or movement needs correction.

Regenerate local motion sources from `mobile/` with:

```sh
npm run generate:number-motion-drafts
```
