import json
from pathlib import Path

import numpy as np
import pytest

from src.import_calibration import export_records, load_records, split_records


def write_sample(path: Path, frame_count: int = 12) -> None:
    frames = np.zeros((frame_count, 543, 3), dtype=np.float32)
    frames[:, 11] = [0.4, 0.5, 0.0]
    frames[:, 12] = [0.6, 0.5, 0.0]
    frames[:, 33:54] = [0.4, 0.3, 0.0]
    payload = {
        "version": 2,
        "gloss": "HOLA",
        "createdAt": "2026-07-18T00:00:00.000Z",
        "endReason": "hand_release",
        "timestamps": [1000 + index * 50 for index in range(frame_count)],
        "quality": {"valid": True},
        "frames": frames.tolist(),
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_load_split_and_export_calibration_samples(tmp_path: Path) -> None:
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    for index in range(4):
        write_sample(input_dir / f"sample_{index}.json")

    records = load_records(input_dir)
    train, validation = split_records(records, validation_count=1, seed=42)
    export_records(train, tmp_path / "output" / "train", "User01")
    export_records(validation, tmp_path / "output" / "validation", "User01")

    assert len(records) == 4
    assert len(list((tmp_path / "output" / "train").glob("*.npy"))) == 3
    assert len(list((tmp_path / "output" / "validation").glob("*.npy"))) == 1
    exported = np.load(next((tmp_path / "output" / "train").glob("*.npy")))
    assert exported.shape == (12, 543, 3)


def test_rejects_sample_without_valid_quality_flag(tmp_path: Path) -> None:
    write_sample(tmp_path / "sample.json")
    payload = json.loads((tmp_path / "sample.json").read_text(encoding="utf-8"))
    payload["quality"]["valid"] = False
    (tmp_path / "sample.json").write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="did not pass mobile quality checks"):
        load_records(tmp_path)


def write_diagnostic_sample(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "version": 3,
                "purpose": "channel_diagnostic",
                "trainingEligible": False,
                "gloss": "HOLA",
                "requestedSpeed": "natural",
                "rawFrames": [],
                "normalizedFrames": [],
                "timestamps": [],
                "quality": {"valid": True},
            }
        ),
        encoding="utf-8",
    )


def test_excludes_channel_diagnostic_samples_from_training(tmp_path: Path) -> None:
    for index in range(3):
        write_sample(tmp_path / f"train_{index}.json")
    write_diagnostic_sample(tmp_path / "diagnostic_natural.json")

    records = load_records(tmp_path)

    # The diagnostic is dropped by design even though it is version 3 with no
    # `frames` key, so it never reaches the version/shape validation.
    assert len(records) == 3
    assert all("channel_diagnostic" not in str(record.source) for record in records)


def test_directory_of_only_diagnostics_raises_clear_error(tmp_path: Path) -> None:
    write_diagnostic_sample(tmp_path / "diagnostic_natural.json")
    write_diagnostic_sample(tmp_path / "diagnostic_fast.json")

    with pytest.raises(ValueError, match="all 2 file\\(s\\) were channel diagnostics"):
        load_records(tmp_path)
