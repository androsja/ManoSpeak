# LSC number motion drafts

These six JSON files are Android-runtime motion sources for UNO through SEIS. The hand configurations for UNO through CINCO follow the number entries in the [INSOR and Ministry of Education dictionary](https://www.colombiaaprende.edu.co/sites/default/files/files_public/2022-04/Diccionario-lengua-de-senas.pdf). SEIS follows the academic description in [Elementos para una didáctica del lenguaje y las matemáticas en estudiantes sordos de niveles iniciales](../../../../../docs/references/lsc-manuals/README.md): palm forward, index extending and flexing, with the other fingers folded. The source describes the index movement; the two flexions in the avatar are the requested prototype timing. Neither source nor generated JSON validates a regional variant.

The generator builds a canonical one-arm transition and hold pose with explicit finger landmarks. In all six signs, it raises the active hand beside the avatar's face and offsets it to the screen-right side, without placing it over the center of the face. DOS, TRES, and CUATRO use a 1.8 lateral landmark spread plus rig finger splay of 28, 22, and 16 degrees respectively. CINCO uses the same landmark spread with 20 degrees of splay for its four long fingers. These are avatar-clarity adjustments, not regional performance evidence. The inactive hand landmark block is all zero, the runtime's marker that the hand was not captured; this lets the renderer keep the other rig hand at rest. Each JSON also includes the finger-state profile used by the rigged renderer. The motion timing and avatar realization are constructed for a prototype and have not received professional or regional LSC review.

## Authoring and playback

`number-motion-authoring.json` is the editable source for these signs. Finger states, aliases, and supported movement plans live in this data file. Run `npm run generate:number-motion-drafts` from `mobile/` to expand each entry into a frame-based motion JSON and the release catalog.

The generator currently interprets the reusable `finger-flexion-repetitions` movement plan. Its JSON fields select the finger, repetition count, flexion and return duration, pause, and flex amount. SEIS sets `repetitions` to `2`; the generator emits two downward flexions with a return to extension between them. The existing app runtime plays those frames and applies the declared finger profile, so this correction does not add a SEIS-specific runtime rule.

This authoring generator currently covers one-arm number signs and the listed finger movement primitive. It is not yet a universal LSC sign compiler. Other sign families need either captured/authored frame sequences or additional reusable movement primitives described by JSON. A new recurring movement should be added to the generator once as a reusable primitive, then selected and parameterized in sign data.

Firebase release version 11 contains ADIÓS and the one-arm number signs. Spoken and numeric aliases (`uno` and `1`, for example) remain in Firebase manifest metadata, separate from each motion JSON. These are owner-approved prototypes, not professional linguistic validation. `sign-catalog.json` records listening metadata, and the JSON release publisher copies those aliases into each Firebase manifest entry for Android to store with the motion after the user accepts the download.

Regenerate the local motion sources from `mobile/` with:

```sh
npm run generate:number-motion-drafts
```

The generator does not publish a new Firebase release. The base motions remain constructed prototypes; their handshape descriptions are grounded in the cited references.
