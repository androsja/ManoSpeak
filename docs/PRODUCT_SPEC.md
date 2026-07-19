# Product Specification: ManoSpeak

## 1. Product Vision

ManoSpeak is an offline, on-device mobile system intended to convert Colombian Sign
Language (LSC) into accessible spoken Spanish. It extracts geometric landmarks from the
camera instead of transmitting raw video to a cloud service.

Continuous conversational translation is the long-term product vision, not the current
capability. The current checkpoint recognizes isolated clips inconsistently and fails
the natural variable-length LSC50 domain. Product claims follow the capability levels in
`RECOGNITION_CONTRACT.md`.

## 2. Linguistic Foundation

LSC is an independent visual-spatial language, not signed Spanish. Relevant concurrent
features include:

- Handshape: finger and palm configuration.
- Location: position relative to the signer and signing space.
- Movement: trajectory, direction, speed, repetition, and holds.
- Orientation and handedness.
- Non-manual markers: face, head, torso, and gaze.

Handshape, location, and movement are useful model supervision, but one independently
predicted triple is not sufficient to represent arbitrary vocabulary, coarticulation,
LSC grammar, or Spanish sentence generation.

## 3. Delivery Levels

### Level 0: Data Channel

Validate fast, natural, and slow landmark capture. This level does not claim sign
recognition.

### Level 1: Personalized HOLA

Recognize or reject isolated HOLA for one enrolled signer across held-out sessions and
speed bins. This is not CSLR.

### Level 2: Constrained Continuous Pilot

Recognize ordered short sequences from HOLA, TU, YO, GRACIAS, and ADIOS without forcing
hand lowering. The validated signer set and vocabulary must be disclosed.

### Level 3: Expanded Recognition

Expand signer and gloss coverage only after grouped data, confuser, transition,
continuous, latency, and false-commit gates pass.

## 4. Core Goals

- On-device operation without an active network requirement.
- No default raw-video retention.
- Variable-speed and variable-duration signing.
- Explicit rejection of unknown/non-sign motion instead of forced guesses.
- Ordered continuous output without a hand-lowering delimiter.
- Committed-event TTS with no idle or duplicate speech.
- Signer/source/session-disjoint evaluation and honest capability labels.
- Incremental vocabulary growth backed by LSC linguistic review.

## 5. Non-Goals for the Current Program

- General conversational LSC or thousands of production-ready glosses.
- Recording every possible sign combination.
- Claiming LSC grammar or natural Spanish generation from one-gloss dictionary lookup.
- Sign-to-sign animation generation.
- Silent collection or automatic use of personal samples for training.
- Cloud-based mobile inference or raw-camera upload.
- On-device foundation-model training.

## 6. User Experience Requirements

- Diagnostic and enrollment modes clearly announce requested action, start, completion,
  retry, and deletion.
- Normal recognition is rolling and does not require pressing Start per sign.
- Provisional text may change; spoken output occurs only after a stable commit.
- Unknown motion remains silent.
- The camera preview is hidden in normal recognition unless a specific diagnostic needs
  it.
- Permission, model, camera, TTS, and lifecycle errors have visible recovery states.

## 7. Release Boundary

A release may claim only the highest capability level whose complete held-out gates pass
under `EVALUATION_PROTOCOL.md`. Pooled accuracy cannot hide a failed source, signer,
speed bin, transition direction, or non-sign rejection gate.
