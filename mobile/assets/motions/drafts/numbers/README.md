# LSC number motion drafts

These six JSON files are Android-runtime motion sources for UNO through SEIS. The hand configurations for UNO through CINCO follow the number entries in the [INSOR and Ministry of Education dictionary](https://www.colombiaaprende.edu.co/sites/default/files/files_public/2022-04/Diccionario-lengua-de-senas.pdf). SEIS follows the academic description in [Elementos para una didáctica del lenguaje y las matemáticas en estudiantes sordos de niveles iniciales](../../../../../docs/references/lsc-manuals/README.md): palm forward, index extending and flexing, with the other fingers folded. These references do not validate the generated avatar timing or a regional variant.

The generator builds a canonical one-arm transition and hold pose with explicit finger landmarks. In all five signs, it raises the active hand beside the avatar's face and offsets it to the screen-right side, without placing it over the center of the face. DOS, TRES, and CUATRO use a 1.8 lateral landmark spread plus rig finger splay of 28, 22, and 16 degrees respectively. CINCO uses the same landmark spread with 20 degrees of splay for its four long fingers. These are avatar-clarity adjustments, not regional performance evidence. The inactive hand landmark block is all zero, the runtime's marker that the hand was not captured; this lets the renderer keep the other rig hand at rest. Each JSON also includes the finger-state profile used by the rigged renderer. The motion timing and avatar realization are constructed for a prototype and have not received professional or regional LSC review.

Firebase release version 10 contains ADIÓS and the one-arm number signs. SEIS animates one index flexion and return after the hand reaches its high position beside the face; this timing is authored for the avatar and is not timing evidence from the source. The other numbers retain the finger separation described above. Spoken and numeric aliases (`uno` and `1`, for example) remain in the Firebase manifest metadata, separate from each motion JSON. These remain owner-approved prototypes, not professional linguistic validation. `sign-catalog.json` records the listening metadata, and the JSON release publisher copies those aliases into each Firebase manifest entry for Android to store with the motion after the user accepts the download.

Regenerate the local motion sources from `mobile/` with:

```sh
npm run generate:number-motion-drafts
```

The generator does not publish a new Firebase release. The base motions remain constructed prototypes; only their handshape descriptions are grounded in the cited dictionary.
