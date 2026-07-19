# ManoSpeak Evaluation Protocol

_Protocol version: 1.0, 2026-07-19_

## Purpose

This protocol turns the recognition contract into fixed partitions, formulas, gates,
and failure actions. Thresholds are pilot release gates, not claims about current
performance.

## Partition Policy

### Existing LSC70

- Group by the 70 signer IDs before splitting.
- Freeze approximately 70% train, 15% tuning, and 15% test signers with deterministic
  seeded assignment and a persisted manifest.
- Keep gloss distributions as balanced as source availability permits.

### Existing LSC50

- Only five signers are available; use five outer signer-held-out folds.
- In each fold, one signer is test-only, one different signer is tuning-only, and the
  remaining three are training-only.
- Aggregate all five test folds and report native/non-native strata only if the source
  metadata can be mapped to local IDs.

### Personalized HOLA Pilot

- Begin with 45 accepted enrollment clips: 15 fast, 15 natural, and 15 slow, distributed
  across at least two sessions.
- Freeze the model, then collect a separate test set of 30 HOLA attempts, ten per speed,
  across at least two later sessions.
- Collect at least 100 test hard negatives in those later sessions. Include TU, ADIOS,
  wave-like movement, incomplete HOLA, neutral movement, transitions, and unrelated
  gestures.
- If confidence intervals or failure categories are inconclusive, collect another
  balanced batch; do not move test samples into training.

### Continuous Pilot

- Partition by signer before sequence generation or augmentation.
- A personal pilot can validate mechanics but remains a personalized claim.
- A signer-general pilot requires at least three completely held-out test signers.
- Test data must contain real uninterrupted pairs/triples, repeated glosses, neutral
  periods, hard negatives, and natural coarticulation.

## Metric Definitions

### Isolated

- Exact top-1 accuracy: exact correct glosses divided by isolated positive samples.
- Gloss recall: true detections of a target gloss divided by its target attempts.
- Hard-negative false HOLA rate: negative attempts committed as HOLA divided by all hard
  negatives.
- Abstention rate: rejected samples divided by all evaluated samples, reported
  separately for positives and negatives.
- Expected calibration error (ECE): weighted absolute confidence/accuracy gap across ten
  equal-width confidence bins.
- Base regression: new minus frozen-baseline exact accuracy on the identical locked
  source/signer folds; report pooled, macro-source, and per-gloss changes.
- Confusion matrix: count every target/predicted gloss pair. Any single confuser taking
  more than 10% of an enabled gloss's held-out positives blocks that gloss until reviewed,
  even when aggregate accuracy passes.

### Continuous

- Gloss error rate (GER): `(substitutions + deletions + insertions) / reference glosses`
  using minimum edit distance.
- Exact sequence accuracy: streams whose complete committed sequence equals reference,
  divided by evaluated streams.
- Boundary precision/recall/F1: one-to-one matching of predicted and reference boundaries
  within +/-250 ms.
- False commits/minute: committed glosses during labeled non-sign time divided by
  non-sign duration in minutes.
- Commit latency: committed timestamp minus linguistic endpoint; report median and p95.
- Real-time factor, effective FPS, dropped-frame rate, peak memory, and thermal state are
  device metrics, not inferred from desktop execution.

## Acceptance Gates

### Level 0 Channel Diagnostic

| Gate | Threshold | Failure action |
| --- | --- | --- |
| Accepted clips | 3/3: fast, natural, slow | Fix capture and repeat diagnostics |
| Landmark shape/finite values | 100% valid | Stop collection |
| Required hands/shoulders | Pass quality policy for every clip | Retry affected clip |
| Timing/orientation metadata | Complete and ML-compatible | Fix serialization/parity |
| Onset/endpoint integrity | No clipping or artificial fixed-frame hold | Fix segmentation |

### Level 1 Personalized HOLA

| Gate | Threshold | Failure action |
| --- | --- | --- |
| Overall held-out HOLA recall | At least 90% | Do not enable HOLA; analyze failures |
| Recall per speed bin | At least 90% in each bin | Collect/model the failed speed only |
| Hard-negative false HOLA | At most 2% over at least 100 negatives | Disable TTS; improve rejection |
| Positive ECE | At most 0.10 | Recalibrate; do not expose confidence |
| Largest HOLA confuser | At most 10% of held-out positives | Add targeted confusers or reject checkpoint |
| Locked base macro-source regression | No worse than -2 percentage points | Reject personalized checkpoint |

With ten test positives per speed, the speed gate requires at least 9/10 in every bin.
With 100 hard negatives, the false-HOLA gate allows at most two errors. Counts and
confidence intervals are always published with percentages.

### Level 2 Constrained Continuous Pilot

| Gate | Threshold | Failure action |
| --- | --- | --- |
| GER | At most 20% | Do not claim continuous recognition |
| Exact core pair sequence | At least 80% | Add real transition data/model capacity |
| Exact sequence per core pair direction | At least 70% | Target the failed transition |
| Boundary F1 at +/-250 ms | At least 0.85 | Improve decoder/boundary evidence |
| False commits during non-sign | Less than 0.5/minute | Block TTS and improve rejection |
| Commit latency | Median <=500 ms, p95 <=900 ms | Optimize streaming model/decoder |
| Continuous ECE | At most 0.10 | Recalibrate commit confidence |

### Level 3 Expansion

- All Level 2 gates continue to pass on the expanded signer-disjoint test.
- No enabled gloss loses more than five recall points and macro exact accuracy loses no
  more than two points.
- New glosses pass isolated confuser tests and both incoming/outgoing transition tests.
- Mobile performance and security gates remain mandatory.

## Scenario Walkthrough

| # | Scenario | Expected output | Primary metric/gate |
| ---: | --- | --- | --- |
| 1 | Fast HOLA | One committed HOLA | Fast-bin recall |
| 2 | Slow HOLA | One committed HOLA | Slow-bin recall |
| 3 | Neutral observation for one minute | No commits or TTS | False commits/minute |
| 4 | Wave-like confuser/W movement | Reject, no TTS | Hard-negative false HOLA |
| 5 | Incomplete HOLA | Reject, no TTS | Hard-negative false HOLA |
| 6 | HOLA followed by a long endpoint hold | One HOLA only | Duplicate suppression |
| 7 | HOLA -> TU without lowering hands | HOLA, then TU | Exact sequence and latency |
| 8 | TU -> HOLA without lowering hands | TU, then HOLA | Direction-specific sequence |
| 9 | HOLA -> HOLA with a real repeated articulation | Two HOLA events | Repetition handling |
| 10 | HOLA -> unknown gesture -> TU | HOLA, TU; unknown remains silent | Rejection and ordering |
| 11 | HOLA at a chunk/window boundary | One HOLA only | Streaming chunk invariance |
| 12 | Dropped frames/camera interruption | No false commit; recover visibly | Lifecycle and false commit |
| 13 | Held-out signer performs a core pair | Correct ordered pair or abstention | Signer-general test |
| 14 | Clear transcript after a commit | Display clears; no retraining side effect | Correction/privacy contract |

All scenarios have explicit expected behavior. Scenario success never substitutes for
the aggregate held-out metric gates.

## Failure Policy

- A failed channel diagnostic returns to capture implementation; no training starts.
- A failed isolated gate blocks enrollment/release but does not invalidate raw samples
  that pass quality checks.
- A failed source domain must be reported separately; pooled metrics cannot hide it.
- A failed continuous gate prohibits the term CSLR in product/release reporting.
- Threshold tuning uses tuning data only. Test results are evaluated once per frozen
  model/decoder version; changes require a new version and a new untouched test set when
  repeated access would bias decisions.

## Current Baseline Interpretation

- The seed-42 random validation is retained only as a reproducibility baseline.
- It is not an acceptance partition because all 75 signer IDs leak across it.
- Current exact accuracy is LSC70 66.6% and LSC50 0/195; both fail release use.
- No signer-general metric exists until grouped retraining is performed in a later task.
