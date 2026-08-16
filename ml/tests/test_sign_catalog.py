from src.sign_catalog import CATEGORY_ALL, suggested_signs


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
