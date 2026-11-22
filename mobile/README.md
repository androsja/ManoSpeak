# Mobile Module — Vozual

This module contains the React Native code for the on-device user interface, live camera acquisition, frame buffering, and offline speech synthesis (TTS).

## Folder Contents
```text
mobile/
├── assets/
│   └── models/       # Compiled INT8 phonssm_quant.tflite model
├── src/
│   ├── components/   # Camera viewfinders and text overlay components
│   ├── hooks/        # UseFrameProcessor and coordinate buffers hooks
│   ├── services/     # TFLite inference and ONNX local speech synthesis bridges
│   └── App.tsx       # Root React Native application entry point
├── package.json      # Dependencies and execution scripts
└── tsconfig.json     # TypeScript settings
```

## Getting Started
Run:
```bash
npm install
npm run lint
npm test
```

## Published Sign Assets

VOZUAL keeps the editable source motions as JSON files in `assets/motions`.
Android does not package those verbose files. Run the avatar build before an
Android build:

```bash
npm run build:avatar-runtime
```

The build compiles every published motion into a versioned `.motion.bin` file
under `android/app/src/main/assets/avatar/motions`. Each coordinate is stored as
a signed 16-bit integer at a scale of 10,000, preserving all body, hand, and face
landmarks with a maximum quantization error of 0.00005 coordinate units. The
React Native PiP renderer and the full WebView renderer decode the same compact
format, while VOZUAL continues to edit the lossless JSON source.

Refer to [DEVELOPMENT_COMMANDS.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/DEVELOPMENT_COMMANDS.md) for execution details.

## JSON Motion Releases

Local JSON edits do not upload themselves. Test each edited motion, then publish
it through `tools/publish-json-motion-release.cjs` as a new immutable Firebase
release; include every JSON sign in the active release so unchanged signs remain
available. The publisher prints a dry run by default and requires `--publish`
to activate a release. After activation, Android checks Firebase on app startup
and when the app returns to the foreground. It shows an update notice and waits
for the user to open the library and choose whether to download; installed
motions stay unchanged until the user accepts. First-time language setup still
happens in the sign library.

Each release manifest carries the sign's `speechAliases` with its JSON motion
metadata. The user's download choice installs both the motion file and these
aliases into the local library, so speech matching uses the same version the
user accepted. Firebase keeps the aliases as a metadata field on the sign entry;
the motion JSON itself is stored separately in immutable release chunks. Android
builds its continuous-listening vocabulary from every installed sign's gloss and
`speechAliases`, then plays the JSON motion for the matched gloss.

Firebase and the local library both record the published version for each sign.
The app also compares the motion SHA-256 and a semantic release SHA-256 that
covers the aliases. It offers an update when the motion or spoken vocabulary
actually changed, and does not ask the user to re-download unchanged signs just
because the language-wide release number advanced.

`speechAliases` is the curated list of spoken words and phrases for one sign.
It can include inflected forms that should select the same motion, such as
`comer`, `come`, `comes`, and `comía` for a reviewed COMER entry. Add and review
those forms in the release catalog; the app does not guess Spanish conjugations.
This keeps ambiguous words and irregular forms under editorial control. The
same metadata can hold synonyms or numeric forms such as `uno` and `1` without
changing the motion JSON.
