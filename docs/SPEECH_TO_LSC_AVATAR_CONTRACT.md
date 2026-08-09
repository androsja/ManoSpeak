# Speech-to-LSC Avatar Product Contract

## Scope

ManoSpeak will provide a local-first, reviewed phrase catalogue for Colombian Sign
Language (LSC). It is not a general Spanish-to-LSC translator, a word-for-word signer,
or a generative sign system. Only an active catalogue entry may be played.

An entry becomes active only when its Spanish meaning, LSC interpretation, avatar asset,
performer consent, asset licence, and LSC reviewer record are complete and current.

## Normal User Flow

```text
User selects Listen
  -> app records speech only while listening is visibly active
  -> on-device transcript is shown
  -> user confirms or edits the transcript
  -> app resolves an active reviewed catalogue entry
  -> avatar plays its reviewed LSC sequence locally
  -> user may replay, pause, slow down, or start again
```

The normal flow never opens the camera and does not require the user to perform a sign.
The microphone starts only after a deliberate action. Raw audio is not retained by default.

## Outcomes

| Outcome | Required behavior |
| --- | --- |
| Matched | Show the confirmed phrase and play only its active reviewed sequence. |
| Ambiguous | Explain the ambiguity and require a choice from listed supported meanings. |
| Unsupported | Explain that it is unavailable and offer reset/retry; do not sign a nearest phrase. |
| Low confidence or speech failure | Allow retry, edit, or cancel. |
| Missing or invalid asset | Do not play; present a recoverable error. |

No outcome may fabricate an LSC interpretation, substitute a semantically similar sign,
or use generative avatar motion.

## Privacy and Offline Boundary

- Speech recognition and avatar playback must work without an active network connection.
- An engine that sends speech, transcripts, or identifiers to a cloud service without
  explicit approval is not permitted for this release.
- The application does not upload camera frames, landmarks, raw audio, transcripts, or
  translation results.
- Creator camera capture is a separate mode. It requires explicit performer consent,
  offers preview/retake/delete, and keeps reference material local by default.
- Creator material is not training data and cannot be reused without separate consent.

## Avatar and Asset Requirements

The downloaded rigged character is source material, not a mobile-ready asset. Source
archives in `Personaje/1/` must be preserved and excluded from the application. A playable
derivative must retain head, torso, arms, wrists, all fingers, and required facial controls.
Feet are outside the initial viewing frame.

Every playable derivative records source and derivative checksums, licence and attribution,
performer consent, LSC reviewer/version, format, size, framing, and device evidence.
Pre-rendered local clips are validated first. Runtime 3D is allowed only after it passes
the same offline, visual, size, load-time, and target-device gates. Landmarks may assist
human authoring but never replace manual correction and LSC review.

## LSC Approval Record

Before an item becomes active, an LSC reviewer must inspect the complete avatar sequence
in upper-body mobile framing. The record contains catalogue ID, intended Spanish meaning,
LSC gloss/sequence and regional notes, derivative checksum, decision, date, and version.
Missing, expired, rejected, or incomplete approval is fail-closed and returns unsupported.

## Candidate Initial Catalogue

These are product candidates, not approved LSC translations. Their LSC glosses and motion
remain pending qualified LSC review.

| ID | Spanish variants after confirmation | Intended meaning | Priority | Status |
| --- | --- | --- | --- | --- |
| greeting.hello | `hola`, `buenas` | Greeting | P0 | Candidate — unapproved |
| courtesy.thank_you | `gracias`, `muchas gracias` | Thanks | P0 | Candidate — unapproved |
| courtesy.please | `por favor` | Polite request | P1 | Candidate — unapproved |
| response.yes | `sí`, `si` | Affirmation | P1 | Candidate — unapproved |
| response.no | `no` | Negation | P1 | Candidate — unapproved |
| farewell.goodbye | `adiós`, `adios`, `chao` | Farewell | P0 | Candidate — unapproved |
| help.need | `necesito ayuda`, `ayúdame`, `ayudame` | Request for help | P0 | Candidate — unapproved |
| wellbeing.how_are_you | `cómo estás`, `como estas` | Ask about wellbeing | P2 | Candidate — unapproved |

The first reference take requested from the performer is `greeting.hello`, only after the
creator-capture workflow and consent flow are ready. It is not accepted until reviewer
approval exists.

## Release Gates

| Gate | Release requirement |
| --- | --- |
| Catalogue | No more than ten initial candidates; each active item has a complete approval record. |
| Asset size | Source archives are excluded; the selected derivative has documented device evidence. |
| Playback | An approved asset loads and replays locally on every target Android device. |
| Visual clarity | Upper-body framing includes face and both hands/fingers throughout the reviewed sequence. |
| Accessibility | Named replay, pause, slower playback, error recovery, and predictable focus order. |
| Speech | Explicit listening, transcript confirmation, and evidenced offline/privacy behavior. |
| Safety | Unsupported, ambiguous, stale, or incomplete entries never trigger signing. |
| Review | Every active asset has current consent, licence evidence, and LSC approval. |

Task 2 defines numerical asset-size and load-time budgets after real target-device evidence.
