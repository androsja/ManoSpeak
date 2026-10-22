import json
from pathlib import Path

from src.phrase_authoring import (
    append_phrase_drafts,
    new_phrase_drafts,
    phrase_drafts_for_gloss,
)


def test_noun_phrase_drafts_are_stable_and_reviewable() -> None:
    drafts = phrase_drafts_for_gloss("MEDICINA", ["medicina"], "noun")

    assert [draft.identifier for draft in drafts] == [
        "auto-medicina-quiero",
        "auto-medicina-necesito",
        "auto-medicina-donde",
    ]
    assert [draft.spanish for draft in drafts] == [
        "Quiero medicina.",
        "Necesito medicina.",
        "¿Dónde está medicina?",
    ]
    assert drafts[0].gloss_sequence == ("YO", "QUERER", "MEDICINA")
    assert drafts[2].gloss_sequence == ("DÓNDE", "MEDICINA")


def test_verb_phrase_drafts_start_with_a_plain_statement() -> None:
    drafts = phrase_drafts_for_gloss("AYUDAR", ["ayudar"], "verb")

    assert drafts[0].spanish == "Yo ayudo."
    assert drafts[0].gloss_sequence == ("YO", "AYUDAR")
    assert drafts[1].gloss_sequence == ("YO", "QUERER", "AYUDAR")
    assert drafts[2].gloss_sequence == ("NECESITAR", "AYUDAR")


def test_confirmed_phrase_drafts_append_once(tmp_path: Path) -> None:
    source_path = tmp_path / "phrases.json"
    source_path.write_text(
        json.dumps({"schemaVersion": 1, "language": "lsc-CO", "entries": []}),
        encoding="utf-8",
    )
    drafts = phrase_drafts_for_gloss("BAÑO", ["baño"], "noun")

    assert new_phrase_drafts(source_path, drafts) == drafts
    assert append_phrase_drafts(source_path, drafts) == drafts
    assert new_phrase_drafts(source_path, drafts) == ()
    assert append_phrase_drafts(source_path, drafts) == ()

    source = json.loads(source_path.read_text(encoding="utf-8"))
    assert len(source["entries"]) == 3
    assert source["entries"][0] == {
        "id": "auto-bano-quiero",
        "spanish": "Quiero baño.",
        "glossSequence": ["YO", "QUERER", "BAÑO"],
        "sourceGloss": "BAÑO",
        "template": "quiero",
        "editorGenerated": True,
    }
