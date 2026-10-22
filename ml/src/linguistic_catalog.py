"""Shared LSC linguistic catalog used by VOZUAL authoring and mobile speech."""

from __future__ import annotations

import json
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .sign_catalog import (
    DISALLOWED_SPEECH_FORMS_BY_GLOSS,
    authoring_linguistic_defaults,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = REPO_ROOT / "mobile/assets/data/lsc_linguistic_catalog.json"
VERB_TYPES = {
    "none",
    "plain",
    "directional_review_required",
    "spatial_review_required",
}
REVIEW_STATUSES = {"draft", "reviewed", "approved", "legacy_approved", "blocked"}
OWNER_APPROVAL_STATUSES = {"pending", "approved"}


def load_catalog(path: Path = CATALOG_PATH) -> dict[str, Any]:
    """Load and validate the single source of truth for Spanish-to-LSC entries."""

    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1 or data.get("language") != "LSC":
        raise ValueError("Unsupported LSC linguistic catalog.")
    entries = data.get("entries")
    if not isinstance(entries, list):
        raise TypeError("The LSC linguistic catalog must contain an entries list.")
    seen_glosses: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise TypeError("Each linguistic catalog entry must be an object.")
        gloss = str(entry.get("gloss", "")).strip().upper()
        if not gloss or gloss in seen_glosses:
            raise ValueError("Catalog glosses must be non-empty and unique.")
        seen_glosses.add(gloss)
        lsc = entry.get("lsc", {})
        if lsc.get("verbType", "none") not in VERB_TYPES:
            raise ValueError(f"{gloss} has an unsupported LSC verb type.")
        review = entry.get("review", {})
        if review.get("status") not in REVIEW_STATUSES:
            raise ValueError(f"{gloss} has an unsupported review status.")
        owner_approval = review.get("ownerApproval")
        if owner_approval is not None:
            if not isinstance(owner_approval, dict):
                raise TypeError(f"{gloss} has an invalid owner approval record.")
            if owner_approval.get("status") not in OWNER_APPROVAL_STATUSES:
                raise ValueError(f"{gloss} has an unsupported owner approval status.")
    return data


def owner_approval_status(entry: dict[str, Any] | None) -> str:
    """Return the explicit visual approval state; legacy rows stay pending."""

    if entry is None:
        return "pending"
    approval = entry.get("review", {}).get("ownerApproval", {})
    return "approved" if approval.get("status") == "approved" else "pending"


def owner_review_fingerprint(entry: dict[str, Any] | None) -> str | None:
    """Return the exact reviewed motion/runtime fingerprint when available."""

    if entry is None:
        return None
    value = entry.get("review", {}).get("ownerApproval", {}).get(
        "reviewFingerprint"
    )
    return value if isinstance(value, str) and value else None


def is_mobile_compilation_eligible(entry: dict[str, Any]) -> bool:
    """Require publication, linguistic review, and explicit owner approval."""

    return bool(
        entry.get("motion", {}).get("published")
        and entry.get("review", {}).get("status") in {"approved", "legacy_approved"}
        and owner_approval_status(entry) == "approved"
    )


def find_entry(gloss: str, path: Path = CATALOG_PATH) -> dict[str, Any] | None:
    """Find a canonical entry without relying on a Spanish surface form."""

    normalized = gloss.strip().upper()
    return next(
        (
            entry
            for entry in load_catalog(path)["entries"]
            if str(entry["gloss"]).strip().upper() == normalized
        ),
        None,
    )


def speech_forms(entry: dict[str, Any] | None) -> list[str]:
    """Return de-duplicated Spanish forms accepted for one canonical clip."""

    if entry is None:
        return []
    spanish = entry.get("spanish", {})
    raw_forms = [
        *spanish.get("lemmas", []),
        *spanish.get("synonyms", []),
        *(form.get("text", "") for form in spanish.get("forms", []) if isinstance(form, dict)),
    ]
    seen: set[str] = set()
    forms: list[str] = []
    for form in raw_forms:
        if not isinstance(form, str):
            continue
        text = form.strip()
        key = text.casefold()
        if text and key not in seen:
            seen.add(key)
            forms.append(text)
    return forms


def editor_metadata(gloss: str) -> dict[str, object]:
    """Provide editor defaults from the catalog for existing and new records."""

    entry = find_entry(gloss)
    if entry is None:
        return authoring_linguistic_defaults(gloss)
    defaults = authoring_linguistic_defaults(gloss)
    is_generic_entry = (
        entry.get("categories") == ["sin_clasificar"]
        and entry.get("lexicalClass") == "noun"
        and entry.get("lsc", {}).get("verbType") == "none"
        and (
            defaults["categories"] != ["sin_clasificar"]
            or defaults["lexical_class"] != "noun"
            or defaults["verb_type"] != "none"
        )
    )
    override_defaults = bool(entry.get("spanish", {}).get("overrideDefaults", False))
    stored_forms = speech_forms(entry)
    return {
        "categories": list(defaults["categories"] if is_generic_entry else entry.get("categories", defaults["categories"])),
        "lexical_class": str(defaults["lexical_class"] if is_generic_entry else entry.get("lexicalClass", defaults["lexical_class"])),
        "verb_type": str(defaults["verb_type"] if is_generic_entry else entry.get("lsc", {}).get("verbType", defaults["verb_type"])),
        "review_status": str(entry.get("review", {}).get("status", "draft")),
        "speech_aliases": list(
            dict.fromkeys(
                stored_forms
                if override_defaults
                else stored_forms + list(defaults["speech_aliases"])
            )
        ),
    }


def recommended_entries(
    existing_glosses: set[str], category: str | None = None
) -> list[dict[str, Any]]:
    """Recommend approved lexical concepts missing from the local library."""

    existing = {gloss.strip().upper() for gloss in existing_glosses}
    return [
        entry
        for entry in load_catalog()["entries"]
        if str(entry["gloss"]).upper() not in existing
        and (category is None or category in entry.get("categories", []))
    ]


def preview_renderable_plan(
    text: str,
    path: Path = CATALOG_PATH,
) -> tuple[list[str], list[str]]:
    """Preview the approved avatar sequence and explicitly list missing markers."""

    def normalize(value: str) -> str:
        return " ".join(
            "".join(
                character
                for character in unicodedata.normalize("NFD", value.lower())
                if unicodedata.category(character) != "Mn"
            ).replace("¿", " ").replace("?", " ").replace("!", " ").split()
        )

    catalog = load_catalog(path)
    grammar = dict(catalog.get("grammar", {}))
    verb_forms = dict(grammar.get("spanishVerbForms", {}))
    markers = dict(grammar.get("subjectMarkers", {}))
    temporal = dict(grammar.get("temporalMarkers", {}))
    published = {
        str(entry["motion"]["clip"])
        for entry in catalog["entries"]
        if is_mobile_compilation_eligible(entry)
    }
    published_entries: dict[str, dict[str, Any]] = {}
    for entry in catalog["entries"]:
        clip = str(entry.get("motion", {}).get("clip"))
        if clip in published:
            # Preserve the first reviewed linguistic meaning for a shared
            # physical clip. This prevents the article EL from replacing the
            # approved pronoun ÉL when both historical rows point to EL.
            published_entries.setdefault(clip, entry)
    subject_markers = set(markers.values())

    def has_explicit_subject_in_current_clause() -> bool:
        for rendered_gloss in reversed(renderable):
            rendered_entry = published_entries.get(rendered_gloss, {})
            if rendered_entry.get("lsc", {}).get("requiresSubjectMarker"):
                return False
            if (
                rendered_gloss in subject_markers
                or rendered_entry.get("lexicalClass") in {"pronoun", "noun"}
            ):
                return True
        return False

    def candidate_at(index: int) -> tuple[list[str], dict[str, Any]] | None:
        return next(
            (
                (phrase, entry)
                for phrase, entry in candidates
                if words[index : index + len(phrase)] == phrase
            ),
            None,
        )

    non_sign_function_words = {
        "a", "ante", "bajo", "cabe", "con", "contra", "de", "desde",
        "durante", "en", "entre", "hacia", "hasta", "para", "por", "segun",
        "sin", "sobre", "tras", "la", "las", "los", "un", "una", "unos",
        "unas", "y", "o",
    }

    def is_third_person_pronoun_el(index: int) -> bool:
        if words[index] != "el":
            return False
        following = candidate_at(index + 1)
        return bool(following and following[1].get("lexicalClass") == "verb")

    candidates: list[tuple[list[str], dict[str, Any]]] = []
    for entry in catalog["entries"]:
        if str(entry.get("motion", {}).get("clip")) not in published:
            continue
        for form in speech_forms(entry) + [str(entry["gloss"])]:
            normalized = normalize(form).split()
            if normalized:
                candidates.append((normalized, entry))
    candidates.sort(key=lambda item: len(item[0]), reverse=True)
    words = normalize(text).split()
    renderable: list[str] = []
    pending: list[str] = []
    index = 0
    while index < len(words):
        if words[index] in non_sign_function_words:
            index += 1
            continue
        if words[index] == "el" and not is_third_person_pronoun_el(index):
            index += 1
            continue
        match = candidate_at(index)
        if match is None:
            marker = temporal.get(words[index])
            if marker and marker not in published:
                pending.append(str(marker))
            index += 1
            continue
        phrase, entry = match
        surface = " ".join(phrase)
        subject_key = verb_forms.get(surface)
        subject = markers.get(subject_key) if subject_key else None
        if entry.get("lsc", {}).get("requiresSubjectMarker") and subject:
            if subject in published and not has_explicit_subject_in_current_clause():
                renderable.append(subject)
            elif subject not in published:
                pending.append(str(subject))
        renderable.append(str(entry["motion"]["clip"]))
        index += len(phrase)
    return renderable, list(dict.fromkeys(pending))


def upsert_editor_entry(
    *,
    gloss: str,
    categories: list[str],
    lexical_class: str,
    verb_type: str,
    review_status: str,
    speech_aliases: list[str],
    speech_aliases_overridden: bool = False,
    path: Path = CATALOG_PATH,
) -> None:
    """Store an editor-reviewed concept before exposing its clip to mobile."""

    if verb_type not in VERB_TYPES or review_status not in REVIEW_STATUSES:
        raise ValueError("Invalid linguistic metadata.")
    data = load_catalog(path)
    normalized_gloss = gloss.strip().upper()
    forms = [{"text": alias} for alias in speech_aliases]
    entry = next(
        (item for item in data["entries"] if str(item["gloss"]).upper() == normalized_gloss),
        None,
    )
    if entry is None:
        entry = {
            "id": normalized_gloss.casefold().replace(" ", "_"),
            "gloss": normalized_gloss,
            "categories": categories,
            "lexicalClass": lexical_class,
            "spanish": {"lemmas": [], "synonyms": [], "forms": forms},
            "lsc": {"verbType": verb_type, "requiresSubjectMarker": lexical_class == "verb"},
            "motion": {"clip": normalized_gloss, "published": True},
            "review": {"status": review_status, "regionalVariants": []},
        }
        data["entries"].append(entry)
    else:
        entry["categories"] = categories
        entry["lexicalClass"] = lexical_class
        spanish = entry.setdefault("spanish", {})
        if speech_aliases_overridden:
            spanish["lemmas"] = []
            spanish["synonyms"] = []
        spanish["forms"] = forms
        entry.setdefault("lsc", {})["verbType"] = verb_type
        entry["lsc"]["requiresSubjectMarker"] = lexical_class == "verb"
        motion = entry.setdefault("motion", {})
        # The linguistic gloss may use accents while the captured-motion file
        # has a stable legacy identifier (for example ÉL → EL). Updating
        # words must never rename that physical clip.
        motion.setdefault("clip", normalized_gloss)
        motion["published"] = True
        entry.setdefault("review", {})["status"] = review_status
        entry["review"].setdefault("regionalVariants", [])
    entry.setdefault("spanish", {})["overrideDefaults"] = speech_aliases_overridden
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def synchronize_curated_catalog(path: Path = CATALOG_PATH) -> None:
    """Merge curated Spanish coverage into historical editor-created rows.

    Early versions of the editor saved every newly recorded concept as a
    singular noun in ``sin_clasificar``. This migration upgrades only those
    generic placeholders, retains author-provided aliases, and never changes
    the physical motion clip.
    """

    data = load_catalog(path)
    for entry in data["entries"]:
        gloss = str(entry["gloss"]).strip().upper()
        if gloss == "EL" and entry.get("lexicalClass") == "noun":
            # Spanish articles are intentionally omitted by the LSC planner.
            # The historical EL motion remains published through the distinct
            # reviewed pronoun entry ÉL, which points to the same clip.
            entry["categories"] = ["gramatica"]
            entry["lexicalClass"] = "article"
            entry.setdefault("motion", {})["published"] = False
            entry.setdefault("review", {})["status"] = "blocked"
            continue

        defaults = authoring_linguistic_defaults(gloss)
        generic_placeholder = (
            entry.get("categories") == ["sin_clasificar"]
            and entry.get("lexicalClass") == "noun"
            and entry.get("lsc", {}).get("verbType") == "none"
            and (
                defaults["categories"] != ["sin_clasificar"]
                or defaults["lexical_class"] != "noun"
                or defaults["verb_type"] != "none"
            )
        )
        if generic_placeholder:
            entry["categories"] = list(defaults["categories"])
            entry["lexicalClass"] = str(defaults["lexical_class"])
            entry.setdefault("lsc", {})["verbType"] = str(defaults["verb_type"])
            entry["lsc"]["requiresSubjectMarker"] = defaults["lexical_class"] == "verb"

        disallowed_forms = DISALLOWED_SPEECH_FORMS_BY_GLOSS.get(gloss, frozenset())
        spanish = entry.setdefault("spanish", {})
        spanish["lemmas"] = [
            form for form in spanish.get("lemmas", [])
            if str(form).strip().casefold() not in disallowed_forms
        ]
        spanish["synonyms"] = [
            form for form in spanish.get("synonyms", [])
            if str(form).strip().casefold() not in disallowed_forms
        ]
        source_forms = speech_forms(entry)
        if not bool(spanish.get("overrideDefaults", False)):
            source_forms = [*source_forms, *list(defaults["speech_aliases"])]
        combined_forms = [
            form
            for form in source_forms
            if str(form).strip().casefold() not in disallowed_forms
        ]
        unique_forms: dict[str, str] = {}
        for form in combined_forms:
            normalized = str(form).strip()
            if normalized:
                unique_forms.setdefault(normalized.casefold(), normalized)
        spanish["forms"] = [
            {"text": form} for form in unique_forms.values()
        ]

    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_published_motion_manifest(
    path: Path = CATALOG_PATH,
    manifest_path: Path | None = None,
) -> None:
    """Derive the avatar manifest from explicitly owner-approved entries."""

    manifest = manifest_path or REPO_ROOT / "mobile/assets/motions/published_signs.json"
    catalog = load_catalog(path)
    clips = sorted({
        str(entry["motion"]["clip"])
        for entry in catalog["entries"]
        if is_mobile_compilation_eligible(entry)
    })
    manifest.write_text(
        json.dumps({"version": 2, "publishedGlosses": clips}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )


def set_owner_approval(
    gloss: str,
    approved: bool,
    path: Path = CATALOG_PATH,
) -> None:
    """Persist the project owner's explicit visual approval for one sign."""

    data = load_catalog(path)
    normalized_gloss = gloss.strip().upper()
    entry = next(
        (
            item
            for item in data["entries"]
            if str(item["gloss"]).strip().upper() == normalized_gloss
        ),
        None,
    )
    if entry is None:
        raise ValueError(f"{normalized_gloss} is not registered in the catalog.")
    review = entry.setdefault("review", {})
    review["ownerApproval"] = {
        "status": "approved" if approved else "pending",
        "approvedBy": "project_owner",
        "approvedAt": (
            datetime.now(timezone.utc).isoformat(timespec="seconds")
            if approved
            else None
        ),
    }
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def set_owner_review_fingerprint(
    gloss: str,
    fingerprint: str,
    path: Path = CATALOG_PATH,
) -> None:
    """Persist which exact approved sign/runtime combination was reviewed."""

    if not fingerprint:
        raise ValueError("The mobile review fingerprint cannot be empty.")
    data = load_catalog(path)
    normalized_gloss = gloss.strip().upper()
    entry = next(
        (
            item
            for item in data["entries"]
            if str(item["gloss"]).strip().upper() == normalized_gloss
        ),
        None,
    )
    if entry is None:
        raise ValueError(f"{normalized_gloss} is not registered in the catalog.")
    approval = entry.setdefault("review", {}).get("ownerApproval")
    if not isinstance(approval, dict) or approval.get("status") != "approved":
        raise ValueError(
            f"{normalized_gloss} must be owner-approved before saving its review."
        )
    approval["reviewFingerprint"] = fingerprint
    approval["reviewedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def unpublish_entry(gloss: str, path: Path = CATALOG_PATH) -> None:
    """Retain linguistic history while removing a clip from mobile playback."""

    data = load_catalog(path)
    normalized_gloss = gloss.strip().upper()
    for entry in data["entries"]:
        if str(entry["gloss"]).upper() == normalized_gloss:
            entry.setdefault("motion", {})["published"] = False
            entry.setdefault("review", {})["ownerApproval"] = {
                "status": "pending",
                "approvedBy": "project_owner",
                "approvedAt": None,
            }
            break
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
