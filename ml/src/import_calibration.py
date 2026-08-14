import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from phonological_labels import PHONOLOGICAL_LABELS


@dataclass(frozen=True)
class CalibrationRecord:
    source: Path
    gloss: str
    frames: np.ndarray
    metadata: dict[str, Any]


def load_records(input_dir: Path) -> list[CalibrationRecord]:
    records: list[CalibrationRecord] = []
    skipped_diagnostics: list[Path] = []
    for path in sorted(input_dir.rglob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))

        # Task 11 safety guard: channel-diagnostic captures must NEVER enter
        # training. Exclude them by design (mobile marks them explicitly) rather
        # than relying on incidental format mismatches. Runs before any other
        # check so a diagnostic is dropped regardless of its version/shape.
        purpose = str(payload.get("purpose", ""))
        training_eligible = payload.get("trainingEligible", True)
        if purpose == "channel_diagnostic" or training_eligible is False:
            skipped_diagnostics.append(path)
            continue

        gloss = str(payload.get("gloss", ""))
        frames = np.asarray(payload.get("frames", []), dtype=np.float32)
        timestamps = payload.get("timestamps", [])
        quality = payload.get("quality", {})

        if payload.get("version") != 2:
            raise ValueError(f"Unsupported calibration version in {path}")
        if gloss not in PHONOLOGICAL_LABELS:
            raise ValueError(f"Unknown gloss {gloss!r} in {path}")
        if frames.ndim != 3 or frames.shape[1:] != (543, 3):
            raise ValueError(f"Invalid landmark shape {frames.shape} in {path}")
        if len(timestamps) != len(frames):
            raise ValueError(f"Timestamp/frame mismatch in {path}")
        if not np.isfinite(frames).all():
            raise ValueError(f"Non-finite landmark value in {path}")
        if not quality.get("valid", False):
            raise ValueError(f"Sample did not pass mobile quality checks: {path}")

        records.append(
            CalibrationRecord(
                source=path,
                gloss=gloss,
                frames=frames,
                metadata={key: value for key, value in payload.items() if key != "frames"},
            )
        )
    if skipped_diagnostics:
        print(
            f"Excluded {len(skipped_diagnostics)} channel-diagnostic sample(s) "
            f"from training import."
        )
    if not records:
        if skipped_diagnostics:
            raise ValueError(
                f"No training-eligible calibration samples in {input_dir}: "
                f"all {len(skipped_diagnostics)} file(s) were channel diagnostics."
            )
        raise ValueError(f"No calibration JSON files found in {input_dir}")
    return records


def split_records(
    records: list[CalibrationRecord],
    validation_count: int,
    seed: int,
) -> tuple[list[CalibrationRecord], list[CalibrationRecord]]:
    if validation_count < 1 or validation_count >= len(records):
        raise ValueError("validation_count must leave at least one train and one validation sample")
    shuffled = records.copy()
    random.Random(seed).shuffle(shuffled)
    return shuffled[validation_count:], shuffled[:validation_count]


def export_records(records: list[CalibrationRecord], output_dir: Path, prefix: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    if any(output_dir.glob("*.npy")):
        raise FileExistsError(f"Output directory already contains .npy files: {output_dir}")
    manifest: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        filename = f"{prefix}_{index:03d}_{record.gloss}.npy"
        np.save(output_dir / filename, record.frames)
        manifest.append({"file": filename, "source": record.source.name, **record.metadata})
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=True),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Import ManoSpeak Android calibration samples.")
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--validation_count", type=int, default=6)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--prefix", default="User01")
    args = parser.parse_args()

    records = load_records(args.input_dir)
    train_records, validation_records = split_records(
        records,
        validation_count=args.validation_count,
        seed=args.seed,
    )
    export_records(train_records, args.output_dir / "train", args.prefix)
    export_records(validation_records, args.output_dir / "validation", args.prefix)
    print(
        f"Imported {len(records)} samples: "
        f"train={len(train_records)}, validation={len(validation_records)}"
    )


if __name__ == "__main__":
    main()
