# LSC Linguistic Catalog

## Purpose

The catalog is the single source of truth for the Spanish-to-LSC layer. It is
stored at `mobile/assets/data/lsc_linguistic_catalog.json` and is consumed by
both the Android application and the VOZUAL authoring editor.

An avatar motion is never a linguistic entry by itself. A catalog entry binds a
canonical LSC gloss to Spanish recognition forms, semantic categories, LSC
grammar metadata, regional variants, review state, and one optional motion
clip.

## Entry model

Each entry contains:

- `gloss`: canonical LSC concept used by the avatar.
- `categories`: semantic grouping such as `saludos_cortesia`, `necesidades`,
  `verbos_acciones`, or `animales`.
- `spanish`: lemmas, synonyms, and spoken forms accepted by recognition.
- `lexicalClass`: noun, verb, pronoun, question, negation, adjective, or fixed
  expression.
- `lsc.verbType`: `plain`, `directional_review_required`, or
  `spatial_review_required`.
- `motion`: the one canonical clip and whether it is published.
- `review`: approval state and regional variants.

For example, Spanish forms such as `necesito` and `necesitamos` resolve to the
single `NECESITAR` clip. They do not create duplicate motion assets.

## Authoring vocabulary and phrase planner

The VOZUAL editor exposes the complete pending recording path instead of only
one random suggestion. Its planner groups high-value concepts for
accessibility, health, emergencies, public services, payments, transport, and
daily communication. Each row shows the canonical gloss, safe Spanish voice
forms, and one useful coverage phrase.

Phrase presets are Spanish communication goals such as `Necesito ayuda` or
`Soy sordo y necesito un intérprete`. They identify the isolated concepts that
still need a reviewed recording. They are not templates for LSC word order and
must never be converted into a motion by concatenating Spanish grammar. The
editor therefore prepares one missing concept at a time and leaves the final
sequence to Deaf-led LSC review.

Conjugations reuse the canonical lexical motion. Close equivalents are added
only when they name the same reviewed concept. Ambiguous words remain separate:
for example, `intérprete` does not automatically accept `traductor`, and the
help concept does not automatically absorb `auxilio` or `socorro` without
regional validation.

Authors can replace the suggested voice variants from the library search
window. An explicit override is stored in both the sign recipe and the mobile
catalog, so a removed suggestion is not restored during catalog synchronization.
The canonical gloss remains an automatic recognition form and is intentionally
not part of the removable list.

## Publication policy

New motions can be exported only after their linguistic review status is
`approved`. Existing legacy motions are explicitly marked `legacy_approved`.
The legacy `published_signs.json` file is derived from approved catalog entries
for avatar playback compatibility.

## Verb policy

Plain verbs may resolve to a canonical lexical clip. Directional and spatial
verbs are stored with their grammatical type but must not receive automatic
trajectory changes until a Deaf-led LSC review has approved the parameter
model. This prevents Spanish conjugation rules from being incorrectly applied
to LSC.

## Governance

Catalog edits require a documented reviewer, a source or elicitation note, and
an explicit regional-variant decision. The implementation must preserve the
original Spanish transcription for audit while rendering only approved LSC
plans. The INSOR bilingual dictionary is a reference for lexical research; it
does not replace community validation or grant reuse rights for its media.

## Next implementation stages

1. Add reviewed person, time, negation, and question markers as catalog
   entries.
2. Build sentence planning that combines those markers with lexical clips.
3. Add a reviewed spatial-locus model for directional verbs.
4. Add a reviewer workflow and regression corpus with Spanish utterance,
   expected LSC plan, regional variant, and signer approval.
