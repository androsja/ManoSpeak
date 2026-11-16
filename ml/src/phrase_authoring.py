"""Reviewed phrase proposals created alongside a newly published sign."""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class PhraseDraft:
    """One editor-proposed Spanish goal and its reviewable LSC gloss plan."""

    identifier: str
    spanish: str
    gloss_sequence: tuple[str, ...]
    source_gloss: str
    template: str


def _safe_identifier(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.strip().lower())
    ascii_value = "".join(
        character for character in normalized if not unicodedata.combining(character)
    )
    identifier = re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")
    if not identifier:
        raise ValueError("A phrase source word needs a safe identifier.")
    return identifier


def _spanish_surface(gloss: str, speech_aliases: list[str]) -> str:
    surface = next(
        (alias.strip() for alias in speech_aliases if alias.strip()),
        gloss.strip().lower(),
    )
    return surface[:1].upper() + surface[1:]


def _first_person_verb_surface(surface: str, speech_aliases: list[str]) -> str:
    for alias in speech_aliases:
        candidate = alias.strip().lower()
        if " " not in candidate and candidate.endswith("o"):
            return candidate
    infinitive = surface.lower()
    if infinitive.endswith(("ar", "er", "ir")) and len(infinitive) > 2:
        return f"{infinitive[:-2]}o"
    return infinitive


def phrase_drafts_for_gloss(
    gloss: str,
    speech_aliases: list[str],
    lexical_class: str,
) -> tuple[PhraseDraft, ...]:
    """Return three reviewable phrase drafts that include ``gloss``.

    These are authoring proposals, not an assertion that Spanish word order is
    LSC grammar. The editor requires an explicit human confirmation before
    they enter the publishable phrase source.
    """

    normalized_gloss = gloss.strip().upper()
    if not normalized_gloss:
        raise ValueError("A phrase source word is required.")
    source_identifier = _safe_identifier(normalized_gloss)
    surface = _spanish_surface(normalized_gloss, speech_aliases)
    normalized_class = lexical_class.strip().lower()

    templates: tuple[tuple[str, str, tuple[str, ...]], ...]
    if normalized_class == "verb":
        first_person = _first_person_verb_surface(surface, speech_aliases)
        templates = (
            ("yo", f"Yo {first_person}.", ("YO", normalized_gloss)),
            (
                "quiero",
                f"Quiero {surface.lower()}.",
                ("YO", "QUERER", normalized_gloss),
            ),
            (
                "necesito",
                f"Necesito {surface.lower()}.",
                ("NECESITAR", normalized_gloss),
            ),
        )
    else:
        templates = (
            (
                "quiero",
                f"Quiero {surface.lower()}.",
                ("YO", "QUERER", normalized_gloss),
            ),
            (
                "necesito",
                f"Necesito {surface.lower()}.",
                ("NECESITAR", normalized_gloss),
            ),
            (
                "donde",
                f"¿Dónde está {surface.lower()}?",
                ("DÓNDE", normalized_gloss),
            ),
        )

    return tuple(
        PhraseDraft(
            identifier=f"auto-{source_identifier}-{template}",
            spanish=spanish,
            gloss_sequence=sequence,
            source_gloss=normalized_gloss,
            template=template,
        )
        for template, spanish, sequence in templates
    )


def _source_entries(source_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        source = json.loads(source_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read phrase source {source_path}.") from error
    if not isinstance(source, dict) or not isinstance(source.get("entries"), list):
        raise ValueError("Phrase source must contain an entries list.")
    entries = source["entries"]
    if not all(isinstance(entry, dict) for entry in entries):
        raise ValueError("Phrase source entries must be JSON objects.")
    return source, entries


def new_phrase_drafts(source_path: Path, drafts: tuple[PhraseDraft, ...]) -> tuple[PhraseDraft, ...]:
    """Keep only draft IDs not already stored in the phrase authoring source."""

    _, entries = _source_entries(source_path)
    existing_ids = {
        str(entry.get("id", "")).strip()
        for entry in entries
        if str(entry.get("id", "")).strip()
    }
    return tuple(draft for draft in drafts if draft.identifier not in existing_ids)


def append_phrase_drafts(source_path: Path, drafts: tuple[PhraseDraft, ...]) -> tuple[PhraseDraft, ...]:
    """Persist confirmed drafts once, preserving the existing source catalogue."""

    source, entries = _source_entries(source_path)
    additions = new_phrase_drafts(source_path, drafts)
    if not additions:
        return ()
    entries.extend(
        {
            "id": draft.identifier,
            "spanish": draft.spanish,
            "glossSequence": list(draft.gloss_sequence),
            "sourceGloss": draft.source_gloss,
            "template": draft.template,
            "editorGenerated": True,
        }
        for draft in additions
    )
    source_path.write_text(
        json.dumps(source, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return additions
