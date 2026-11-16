from src.sign_catalog import (
    CATEGORY_ALL,
    SIGN_LEARNING_PATH,
    USEFUL_PHRASE_PRESETS,
    authoring_linguistic_defaults,
    example_phrase_for_gloss,
    missing_glosses_for_phrase,
    suggested_signs,
)


def test_suggestions_skip_existing_and_keep_learning_order() -> None:
    suggestions = suggested_signs({"HOLA", "BUENOS DÍAS"})

    assert suggestions[0].gloss == "BUENAS TARDES"
    assert all(entry.gloss not in {"HOLA", "BUENOS DÍAS"} for entry in suggestions)


def test_suggestions_filter_to_category() -> None:
    suggestions = suggested_signs(set(), "Animales")

    assert [entry.gloss for entry in suggestions] == [
        "PERRO",
        "GATO",
        "PÁJARO",
        "PEZ",
        "CABALLO",
        "VACA",
    ]
    assert CATEGORY_ALL != "Animales"


def test_suggested_signs_include_a_duration_recommendation() -> None:
    suggestion = suggested_signs(set())[1]

    assert suggestion.gloss == "BUENOS DÍAS"
    assert suggestion.recommended_duration_seconds == 1.8


def test_priority_vocabulary_covers_accessibility_health_and_services() -> None:
    glosses = {entry.gloss for entry in SIGN_LEARNING_PATH}

    assert {
        "SORDO",
        "INTÉRPRETE",
        "LENGUA DE SEÑAS",
        "ESCRIBIR",
        "AMBULANCIA",
        "POLICÍA",
        "MEDICINA",
        "ALERGIA",
        "PRECIO",
        "TARJETA",
        "EFECTIVO",
        "DOCUMENTO",
        "CITA",
        "TURNO",
        "AEROPUERTO",
        "AUTOBÚS",
        "TAXI",
    }.issubset(glosses)


def test_new_verbs_reuse_one_sign_for_conjugated_voice_forms() -> None:
    escribir = authoring_linguistic_defaults("ESCRIBIR")
    ayudar = authoring_linguistic_defaults("AYUDAR")
    caminar = authoring_linguistic_defaults("CAMINAR")

    assert escribir["lexical_class"] == "verb"
    assert isinstance(escribir["speech_aliases"], list)
    assert isinstance(ayudar["speech_aliases"], list)
    assert {
        "escribo",
        "escribimos",
        "escribió",
        "escribirán",
        "escríbame",
    }.issubset(escribir["speech_aliases"])
    assert {"ayuda", "ayúdame", "ayúdeme"}.issubset(
        ayudar["speech_aliases"]
    )
    assert "auxilio" not in ayudar["speech_aliases"]
    assert caminar["lexical_class"] == "verb"
    assert caminar["categories"] == ["verbos_acciones"]
    assert {
        "caminar",
        "camino",
        "caminamos",
        "caminó",
        "caminarán",
        "camine",
        "caminando",
    }.issubset(caminar["speech_aliases"])

    polite_forms = {
        "LLAMAR": "llame",
        "ESCRIBIR": "escriba",
        "REPETIR": "repita",
        "ENTRAR": "entre",
        "ABRIR": "abra",
    }
    for gloss, spoken_form in polite_forms.items():
        aliases = authoring_linguistic_defaults(gloss)["speech_aliases"]
        assert isinstance(aliases, list)
        assert spoken_form in aliases


def test_noun_and_adjective_equivalents_are_conservative() -> None:
    medicine = authoring_linguistic_defaults("MEDICINA")
    deaf = authoring_linguistic_defaults("SORDO")
    interpreter = authoring_linguistic_defaults("INTÉRPRETE")

    assert isinstance(interpreter["speech_aliases"], list)
    assert medicine["speech_aliases"] == [
        "medicina",
        "medicinas",
        "medicamento",
        "medicamentos",
    ]
    assert deaf["speech_aliases"] == ["sordo", "sorda", "sordos", "sordas"]
    assert "traductor" not in interpreter["speech_aliases"]


def test_useful_phrases_only_reference_curated_recording_concepts() -> None:
    curated = {entry.gloss for entry in SIGN_LEARNING_PATH}

    assert len(USEFUL_PHRASE_PRESETS) >= 20
    for phrase in USEFUL_PHRASE_PRESETS:
        assert set(phrase.required_glosses).issubset(curated), phrase.spoken_text


def test_phrase_progress_reuses_accented_legacy_motion_labels() -> None:
    phrase = next(
        item
        for item in USEFUL_PHRASE_PRESETS
        if item.spoken_text == "Mi hermana es sorda"
    )

    assert missing_glosses_for_phrase(phrase, {"HERMANO"}) == ("SORDO",)
    assert missing_glosses_for_phrase(phrase, {"HERMANO", "SORDO"}) == ()
    assert example_phrase_for_gloss("INTERPRETE") == (
        "Soy sordo y necesito un intérprete"
    )
