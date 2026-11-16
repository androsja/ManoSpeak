# HOLA Golden Regression

`mobile/tools/verify-hola-golden.js` is a local, read-only regression gate for
`mobile/assets/motions/hola.motion.json`. It verifies the raw file byte length
and SHA-256 before parsing the JSON contract. It then checks:

- 30 FPS and 36 frames;
- `pose33_left21_right21_face468` layout;
- left active hand;
- forehead contact from frames 0 through 12;
- camera-facing palm at contact.

Run it from `mobile/`:

```bash
node tools/verify-hola-golden.js
```

The gate has no Firebase, Android, APK, device, or asset-writing dependency.
The SHA-256 is the reviewed golden identity of the current HOLA file. Any
intentional asset change must update the golden value through a separate
review; this regression must not rewrite the motion asset automatically.
