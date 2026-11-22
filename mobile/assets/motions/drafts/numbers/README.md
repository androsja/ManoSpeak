# LSC number motion drafts

These five JSON files are Android-runtime motion sources for UNO through CINCO. Their hand configurations follow the number entries in the [INSOR and Ministry of Education dictionary](https://www.colombiaaprende.edu.co/sites/default/files/files_public/2022-04/Diccionario-lengua-de-senas.pdf). The dictionary documents finger configurations; it does not validate these generated avatar motions or a regional variant.

The generator builds a canonical one-arm transition and hold pose with explicit finger landmarks. In all five signs, it raises the active hand beside the avatar's face and offsets it to the screen-right side, without placing it over the center of the face. DOS, TRES, and CUATRO use a 1.8 lateral landmark spread plus rig finger splay of 28, 22, and 16 degrees respectively. CINCO uses the same landmark spread with 20 degrees of splay for its four long fingers. These are avatar-clarity adjustments, not regional performance evidence. The inactive hand landmark block is all zero, the runtime's marker that the hand was not captured; this lets the renderer keep the other rig hand at rest. Each JSON also includes the finger-state profile used by the rigged renderer. The motion timing and avatar realization are constructed for a prototype and have not received professional or regional LSC review.

The active Firebase release is versioned separately from the Android app and contains ADIÓS and all five one-arm numbers. The latest release widens the long fingers in CINCO as well as DOS, TRES, and CUATRO; unchanged signs remain in the full manifest. Spoken and numeric aliases (`uno` and `1`, for example) remain in the Firebase manifest metadata, separate from each motion JSON. This remains an owner-approved prototype, not professional linguistic validation. `sign-catalog.json` records the listening metadata, and the JSON release publisher copies those aliases into each Firebase manifest entry for Android to store with the motion after the user accepts the download.

Regenerate the local motion sources from `mobile/` with:

```sh
npm run generate:number-motion-drafts
```

The generator does not publish a new Firebase release. The base motions remain constructed prototypes; only their handshape descriptions are grounded in the cited dictionary.
