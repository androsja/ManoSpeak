# HOLA motion regression

The local HOLA draft follows the right-handed demonstration in [Una seña para ti: Hola, by INSOR](https://conecta.insor.gov.co/contenido-accesible/una-sena-para-ti-hola/). At 30 FPS, the 73 frames include the opening and closing rest. The right hand rises from the abdomen with the fingers together, angled toward the outer right eyebrow. The index fingertip reaches the temple at frames 16–19. The open hand lifts slightly away, turns during the descent and returns to the left hand at the abdomen.

The authored depth is an estimate from the frontal video. The shared avatar runtime uses shoulder-relative depth and the model’s temple to reproduce the contact on its own skeleton. The JSON is a local draft pending visual review.

The latest owner visual reference supersedes the earlier pose requested at
896 ms. Right wrist X/Y/Z reaches −17°/85°/4° at frame 13 (433 ms), holds through
frame 33 (1100 ms) during ascent and outward release, then relaxes by frame 39
(1300 ms) for the descent. Thumb extension is 100% and forearm axial rotation
is 0°. The same settings apply on the way up and as the hand moves forward.

From `mobile/`, run the regression check with:

```sh
node tools/verify-hola-golden.js
```

It verifies the asset digest, frame count, frame rate, landmark layout, active hand, contact interval and palm orientation. An intentional motion change requires updating the expected values after comparing the new playback with the reference.
