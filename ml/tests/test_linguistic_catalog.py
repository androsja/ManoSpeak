import json
import unicodedata

from src.linguistic_catalog import (
    CATALOG_PATH,
    editor_metadata,
    find_entry,
    load_catalog,
    preview_renderable_plan,
    speech_forms,
    synchronize_curated_catalog,
    upsert_editor_entry,
    write_published_motion_manifest,
)
from src.sign_catalog import (
    ADJECTIVE_SPEECH_EQUIVALENTS,
    FIXED_EXPRESSION_SPEECH_FORMS,
    NOUN_SPEECH_EQUIVALENTS,
    VERB_SPEECH_FORMS,
    authoring_linguistic_defaults,
    suggested_signs,
)


def test_catalog_covers_the_published_necesitar_verb() -> None:
    entry = find_entry("NECESITAR")

    assert entry is not None
    assert entry["lsc"]["verbType"] == "plain"
    assert {"necesito", "necesitamos", "requiero"}.issubset(speech_forms(entry))


def test_catalog_supplies_editor_defaults_from_one_shared_source() -> None:
    metadata = editor_metadata("IR")

    assert metadata["verb_type"] == "directional_review_required"
    assert metadata["review_status"] == "legacy_approved"

    comer = editor_metadata("COMER")
    assert comer["lexical_class"] == "verb"
    assert {"como", "comida", "comeremos", "alimentar", "alimentaremos"}.issubset(
        comer["speech_aliases"]
    )


def test_catalog_has_unique_canonical_glosses() -> None:
    catalog = load_catalog()
    glosses = [entry["gloss"] for entry in catalog["entries"]]

    assert len(glosses) == len(set(glosses))
    assert find_entry("ÉL")["motion"]["clip"] == "EL"


def test_editor_and_mobile_use_the_same_forms_for_every_published_sign() -> None:
    for entry in load_catalog()["entries"]:
        if not entry.get("motion", {}).get("published"):
            continue
        gloss = str(entry["gloss"])
        mobile_forms = {form.casefold() for form in speech_forms(entry)}
        editor_forms = {
            str(form).casefold() for form in editor_metadata(gloss)["speech_aliases"]
        }
        assert mobile_forms == editor_forms, gloss


def test_preview_inserts_only_published_subject_markers() -> None:
    assert preview_renderable_plan("necesito ayuda") == (["YO", "NECESITAR", "AYUDAR"], [])
    assert preview_renderable_plan("necesitamos ayuda") == (
        ["NECESITAR", "AYUDAR"],
        ["NOSOTROS"],
    )
    assert preview_renderable_plan("yo no quiero comer") == (
        ["YO", "NO", "QUERER", "COMER"],
        [],
    )
    assert preview_renderable_plan("el médico come") == (["MÉDICO", "COMER"], [])
    assert preview_renderable_plan("el come") == (["EL", "COMER"], [])
    assert preview_renderable_plan("el médico come con perro") == (
        ["MÉDICO", "COMER", "PERRO"],
        [],
    )


def test_every_curated_verb_has_a_complete_set_of_spoken_forms() -> None:
    assert all(len(forms) >= 20 for forms in VERB_SPEECH_FORMS.values())
    assert {"puedo", "pudimos", "podremos", "podrían"}.issubset(
        VERB_SPEECH_FORMS["PODER"]
    )
    assert {"ayudo", "ayudamos", "ayudaron", "ayudaré"}.issubset(
        VERB_SPEECH_FORMS["AYUDAR"]
    )
    assert {"pago", "pagué", "pagamos", "pagarán"}.issubset(
        VERB_SPEECH_FORMS["PAGAR"]
    )
    assert "pagé" not in VERB_SPEECH_FORMS["PAGAR"]


def test_no_entiendo_uses_one_lsc_recording_for_negative_conjugations() -> None:
    metadata = authoring_linguistic_defaults("NO ENTIENDO")

    assert metadata["lexical_class"] == "fixed_expression"
    assert {"no entiendo", "no entiendes", "no entiende", "no entendemos", "no entendieron", "no comprendo", "no lo entiendo"}.issubset(
        metadata["speech_aliases"]
    )
    assert metadata["speech_aliases"] == list(FIXED_EXPRESSION_SPEECH_FORMS["NO ENTIENDO"])


def test_quantity_variants_share_the_mucho_sign() -> None:
    mucho = editor_metadata("MUCHO")

    assert mucho["categories"] == ["numeros_cantidades"]
    assert mucho["lexical_class"] == "adjective"
    assert mucho["speech_aliases"] == ["mucho", "mucha", "muchos", "muchas"]


def test_legacy_trabajo_recording_uses_the_trabajar_verb_inventory() -> None:
    trabajo = editor_metadata("TRABAJO")

    assert trabajo["lexical_class"] == "verb"
    assert trabajo["categories"] == ["verbos_acciones"]
    assert {"trabajo", "trabajamos", "emplear", "empleamos", "empleo"}.issubset(
        trabajo["speech_aliases"]
    )


def test_authoring_defaults_keep_only_close_noun_equivalents() -> None:
    doctor = authoring_linguistic_defaults("MÉDICO")

    assert doctor["speech_aliases"] == [
        "médico", "médica", "médicos", "médicas",
        "doctor", "doctora", "doctores", "doctoras",
    ]
    assert "caballo" not in NOUN_SPEECH_EQUIVALENTS["MÉDICO"]
    assert "auxilio" not in authoring_linguistic_defaults("AYUDAR")["speech_aliases"]


def test_curated_gender_and_number_families_are_complete() -> None:
    expected = {
        "PREOCUPADO": {"preocupado", "preocupada", "preocupados", "preocupadas"},
        "ENOJADO": {"enojado", "enojada", "enojados", "enojadas"},
        "CANSADO": {"cansado", "cansada", "cansados", "cansadas"},
        "POCO": {"poco", "poca", "pocos", "pocas"},
    }

    for gloss, forms in expected.items():
        metadata = authoring_linguistic_defaults(gloss)
        assert metadata["lexical_class"] == "adjective"
        assert forms.issubset(set(metadata["speech_aliases"]))
        assert forms.issubset(set(ADJECTIVE_SPEECH_EQUIVALENTS[gloss]))

    assert set(authoring_linguistic_defaults("NIÑO")["speech_aliases"]) == {
        "niño", "niña", "niños", "niñas",
    }


def test_suggestions_do_not_repeat_a_published_accented_gloss() -> None:
    suggestions = suggested_signs({"EL"}, "Personas y familia")

    assert all(entry.gloss != "ÉL" for entry in suggestions)


def test_published_manifest_counts_each_motion_clip_once(tmp_path) -> None:
    manifest = tmp_path / "published_signs.json"

    write_published_motion_manifest(manifest_path=manifest)

    published = json.loads(manifest.read_text(encoding="utf-8"))["publishedGlosses"]
    assert published.count("EL") == 1
    assert len(published) == len(set(published))


def test_published_editor_entries_have_curated_classes_and_voice_coverage() -> None:
    expected = {
        "BLANCO": ("adjective", {"blanco", "blanca", "blancos", "blancas"}),
        "CUÁNDO": ("question", {"cuándo", "cuando"}),
        "ELLA": ("pronoun", {"ella"}),
        "GUSTAR": ("verb", {"gusto", "gustas", "gustamos", "gustaron"}),
        "MAÑANA": ("temporal_adverb", {"mañana"}),
        "TRANQUILO": ("adjective", {"tranquilo", "tranquila", "tranquilos", "tranquilas"}),
    }

    for gloss, (lexical_class, forms) in expected.items():
        entry = find_entry(gloss)
        assert entry is not None
        assert entry["lexicalClass"] == lexical_class
        assert forms.issubset(set(speech_forms(entry)))

    article = find_entry("EL")
    assert article is not None
    assert article["lexicalClass"] == "article"
    assert article["motion"]["published"] is False


def test_all_published_signs_have_reviewed_linguistic_metadata() -> None:
    published = [
        entry
        for entry in load_catalog()["entries"]
        if entry.get("motion", {}).get("published")
        and entry.get("review", {}).get("status") in {"approved", "legacy_approved"}
    ]

    assert len(published) >= 50
    for entry in published:
        assert entry["categories"] != ["sin_clasificar"], entry["gloss"]
        assert entry["lexicalClass"] != "article", entry["gloss"]
        assert speech_forms(entry), entry["gloss"]
        if entry["lexicalClass"] == "verb":
            assert len(speech_forms(entry)) >= 20, entry["gloss"]


def test_a_distinct_llegar_sign_owns_its_own_spoken_infinitive() -> None:
    assert "llegar" not in speech_forms(find_entry("VENIR"))
    assert "llegar" in speech_forms(find_entry("LLEGAR"))


def test_published_voice_forms_do_not_select_two_different_signs() -> None:
    def normalize(value: str) -> str:
        return " ".join(
            "".join(
                character
                for character in unicodedata.normalize("NFD", value.casefold())
                if unicodedata.category(character) != "Mn"
            )
            .replace("¿", " ")
            .replace("?", " ")
            .replace("!", " ")
            .split()
        )

    owners: dict[str, str] = {}
    for entry in load_catalog()["entries"]:
        if not entry.get("motion", {}).get("published"):
            continue
        for form in [str(entry["gloss"]), *speech_forms(entry)]:
            key = normalize(form)
            assert owners.setdefault(key, str(entry["gloss"])) == str(entry["gloss"]), key


def test_explicit_voice_override_survives_curated_catalog_sync(tmp_path) -> None:
    catalog_path = tmp_path / "catalog.json"
    catalog_path.write_text(CATALOG_PATH.read_text(encoding="utf-8"), encoding="utf-8")

    upsert_editor_entry(
        gloss="GRACIAS",
        categories=["saludos_cortesia"],
        lexical_class="fixed_expression",
        verb_type="none",
        review_status="approved",
        speech_aliases=["te agradezco"],
        speech_aliases_overridden=True,
        path=catalog_path,
    )
    synchronize_curated_catalog(catalog_path)

    entry = find_entry("GRACIAS", catalog_path)
    assert entry is not None
    assert entry["spanish"]["overrideDefaults"] is True
    assert speech_forms(entry) == ["te agradezco"]
