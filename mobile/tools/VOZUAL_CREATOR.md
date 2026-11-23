# VOZUAL Creator

VOZUAL Creator creates local JSON files for motion drafts. It does not edit the mobile app, manage releases, or publish to Firebase.

## Start the creator

Double-click `desktop/macos/VOZUALCreator.command`, or run this from `mobile/`:

```sh
npm run creator:json
```

The local page opens in the default browser. Stop the local server with `Ctrl+C` in the terminal.

## Files it creates

Each creation writes two files under `mobile/assets/motions/drafts/creator/`:

- `<gloss>.authoring.json` is the compact editable recipe: gloss, spoken aliases, source, finger states, hand position, and supported movement settings.
- `<gloss>.motion.json` is the expanded frame document the mobile JSON motion loader can read.

After creating a draft, select **Ver seña en el avatar** to open a local, playback-only preview. Creator compiles a temporary runtime package with the same `avatar-runtime.ts`, avatar model, and compact motion compiler used by the mobile preview. This step neither edits the production sign library nor publishes anything.

## Runtime boundary

Creator owns authoring inputs and JSON generation. Avatar playback stays in the shared mobile runtime; the preview page is an adapter that loads the generated motion through that runtime. Keeping this boundary avoids a second animation implementation. As new movement families are added, a strategy registry keyed by the JSON movement type can keep each reusable generator operation independent.

The recipe is the source for future adjustments. Load it with **Abrir JSON de autoría**, adjust its fields, and generate the motion again. Creator writes drafts and does not imply linguistic approval.

## Supported authoring in this first version

- One active hand, currently the avatar's left hand.
- Captured, extended, and closed finger states.
- Landmark finger spread and rig finger splay.
- Active wrist and elbow coordinates.
- Repeated flexion and return for one selected finger, with editable repetition count, timing, pause, and flex amount.

When a sign fits these controls, its motion can be adjusted by editing its recipe JSON. A movement family outside this list needs one reusable generator operation before Creator can expose it. This first version does not claim to represent every LSC sign.

The generator reuses `generate-lsc-number-motion-drafts.cjs` so generated frames follow the same landmark layout and finger-motion interpretation as the existing number drafts.
