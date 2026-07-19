# ManoSpeak Recognition Contract

_Contract version: 1.0, 2026-07-19_

## Purpose

This contract defines what ManoSpeak may claim, what each recognition mode consumes and
emits, and when an output is safe to display or speak. It separates controlled data
collection from runtime recognition and prevents isolated-sign results from being
reported as continuous LSC translation.

## Capability Levels

| Level | Name | Vocabulary | Claim allowed |
| --- | --- | --- | --- |
| 0 | Channel diagnostic | HOLA prompt only | Camera and landmark channel is usable |
| 1 | Personalized isolated pilot | `HOLA`, `UNKNOWN/NON_SIGN` | HOLA recognition for the enrolled signer |
| 2 | Constrained continuous pilot | `HOLA`, `TU`, `YO`, `GRACIAS`, `ADIOS`, `UNKNOWN/NON_SIGN` | Ordered short sequences for validated signers |
| 3 | Expanded continuous recognition | Only glosses passing release gates | Signer-general CSLR within the declared vocabulary/domain |

The current implementation is below Level 1 acceptance. It accepts variable-duration
clips but has one target token per clip and one pooled mobile output per window.

## Shared Input Contract

- Input is a timestamped stream of 543 MediaPipe-compatible landmarks per accepted
  frame: 33 pose, 21 left hand, 21 right hand, and 468 face points.
- Original monotonic timestamps, effective FPS, missing-landmark masks, orientation,
  mirror state, source, signer, session, and extraction version must be retained in the
  sample manifest.
- Variable sign duration is preserved. Fast signs may contain fewer frames and slow
  signs may contain more frames.
- Fixed 30-frame stretching, truncation, or waiting is not a linguistic boundary.
- Raw video is not required by the model and is not retained by default.

## Level 0: Channel Diagnostic

- Entry requires explicit user initiation and a spoken/visible speed prompt.
- Exactly three accepted clips are requested: fast, natural, and slow HOLA.
- A button, countdown, or hand release may assist annotation in this mode only.
- Output is quality metadata and `ACCEPT/RETRY`; no recognition accuracy is reported.
- Diagnostic samples are excluded from all training manifests.

## Level 1: Personalized Isolated Pilot

- Input is one prompted isolated attempt with a known evaluation boundary.
- Output is one of `HOLA` or `UNKNOWN/NON_SIGN`, plus calibrated confidence and timing.
- Results are valid only for the enrolled signer and declared sessions/camera domain.
- TTS may speak HOLA only after a committed result. Abstention remains silent.
- This mode cannot emit `HOLA -> TU` and cannot be described as continuous recognition.

## Level 2 and 3: Continuous Runtime

- Input is a rolling stream. The signer does not press Start for every sign.
- Hands may remain visible and move directly from one sign into the next.
- Hand lowering, a neutral pose, or a fixed silence duration is never required as
  punctuation.
- The decoder maintains ordered provisional hypotheses and committed gloss events.
- Non-sign motion and uncertain signs produce no committed gloss and no TTS.
- The constrained pilot vocabulary is intentionally small. Expansion is incremental,
  and a gloss is enabled only after positive, confuser, transition, and signer tests.

## Output Event

Every candidate has the following semantic fields, independent of serialization:

```text
event_id
gloss
status: PROVISIONAL | COMMITTED | REJECTED
linguistic_start_ms
linguistic_end_ms
commit_ms
confidence
model_version
decoder_version
```

- Confidence is calibrated on tuning data; raw maximum logits are not user confidence.
- `UNKNOWN/NON_SIGN` is an internal rejection result, not spoken vocabulary.
- A provisional event may change or disappear. A committed event is never silently
  rewritten.
- TTS consumes only `COMMITTED` events and speaks each `event_id` at most once.

## Boundaries and Latency

- Linguistic onset is the first frame where the target sign begins its contrastive
  movement, handshape, location, or non-manual articulation after the preceding context.
- Linguistic endpoint is the last frame carrying contrastive evidence before the next
  sign, non-sign motion, or non-contrastive hold.
- Coarticulated signs share a transition region. Annotators place one adjudicated
  boundary rather than requiring neutral frames.
- Commit latency is `commit_ms - linguistic_end_ms`. Prompt time, TTS instruction time,
  and camera startup are excluded from recognition latency.

## Ordering, Repetition, and Holds

- `HOLA -> TU` must emit two committed events in the same order.
- `HOLA -> HOLA` must emit two events only when blank/boundary and sequence evidence
  support a true repetition.
- Holding the endpoint of HOLA must not emit duplicate HOLA events.
- Hysteresis suppresses duplicate commits but may not suppress a linguistically repeated
  sign.
- An unknown gesture between two valid signs does not merge them or create speech.

## Corrections

- Provisional hypotheses may be updated without user action.
- A committed result cannot be automatically replaced after TTS.
- The user can clear the displayed transcript. Clear does not alter evaluation labels or
  silently add the sample to training.
- Future correction events must reference the original `event_id` explicitly.

## Data Separation

- Dataset partitions are grouped by signer, source, and session before augmentation.
- The same signer cannot appear in train and test for a signer-general claim.
- Personalized enrollment data cannot appear in its own held-out session test.
- LSC70 and LSC50 are reported separately because they represent different temporal
  domains. A macro source score is reported in addition to pooled accuracy.
- Synthetic concatenations are labeled pretraining data and never count as real
  coarticulated test sequences.

## Claim Rules

- Level 0 pass means only that collection may continue.
- Level 1 pass is always labeled personalized/single-signer.
- Level 2 pass is always labeled constrained vocabulary and lists validated signers.
- Level 3 requires signer-disjoint continuous tests and may claim only its enabled
  vocabulary and usage domain.
- No result is described as LSC translation solely because it maps one gloss to one
  Spanish word. LSC grammar and Spanish generation are separate future contracts.

## Vocabulary Expansion

A new gloss requires:

1. Linguistic review and one stable gloss identifier.
2. Multiple signers and sessions with speed/style variation.
3. Hard negatives and visually/phonologically related confusers.
4. Real transitions to and from existing glosses.
5. Signer-disjoint isolated and continuous acceptance.
6. No material regression in already enabled glosses.

The system learns reusable glosses and transitions; it does not require recording every
possible sentence. Representative coarticulation and a language-level decoder are still
required before broad conversational claims.
