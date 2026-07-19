from collections import Counter, defaultdict

from src.evaluate_checkpoint import summarize_groups


def test_summarize_groups_reports_accuracy_and_stable_confusions() -> None:
    totals = Counter({"HOLA": 3})
    correct = Counter({"HOLA": 2})
    predictions = defaultdict(Counter, {"HOLA": Counter({"HOLA": 2, "ADIOS": 1})})

    summary = summarize_groups(totals, correct, predictions)

    assert summary == {
        "HOLA": {
            "correct": 2,
            "total": 3,
            "accuracy": 2 / 3,
            "top_predictions": {"HOLA": 2, "ADIOS": 1},
        }
    }
