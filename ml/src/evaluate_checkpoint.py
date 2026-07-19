import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import torch
from torch.utils.data import DataLoader, Subset

from model import PhonSSM
from audit_dataset import parse_sample_identity
from phonological_labels import PHONOLOGICAL_LABELS
from train import LSCDataset, collate_fn, select_device


def strongest_nonblank(logits: torch.Tensor, length: int, blank_index: int) -> int:
    valid_logits = logits[:length, :blank_index]
    return int(valid_logits.max(dim=0).values.argmax().item())


def summarize_groups(
    totals: Counter[str],
    correct: Counter[str],
    predictions: dict[str, Counter[str]],
) -> dict[str, dict[str, Any]]:
    """Build stable per-group accuracy and confusion summaries."""
    return {
        group: {
            "correct": correct[group],
            "total": totals[group],
            "accuracy": correct[group] / totals[group] if totals[group] else 0.0,
            "top_predictions": dict(predictions[group].most_common(10)),
        }
        for group in sorted(totals)
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a PhonSSM checkpoint.")
    parser.add_argument("checkpoint")
    parser.add_argument("--data_dir", default="../datasets/landmarks_unified")
    parser.add_argument("--batch_size", type=int, default=32)
    parser.add_argument("--val_split", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--all_samples",
        action="store_true",
        help="Evaluate every sample in data_dir instead of a random validation split.",
    )
    parser.add_argument("--focus", nargs="*", default=["HOLA", "GRACIAS", "COLOMBIA"])
    parser.add_argument("--output", type=Path, help="Optional JSON metrics output path.")
    args = parser.parse_args()

    dataset = LSCDataset(args.data_dir, augment=False)
    val_dataset: torch.utils.data.Dataset
    if args.all_samples:
        val_dataset = dataset
        evaluated_paths = dataset.file_paths
    else:
        val_size = int(len(dataset) * args.val_split)
        permutation = torch.randperm(
            len(dataset), generator=torch.Generator().manual_seed(args.seed)
        ).tolist()
        validation_indices = permutation[len(dataset) - val_size :]
        val_dataset = Subset(dataset, validation_indices)
        evaluated_paths = [dataset.file_paths[index] for index in validation_indices]
    loader = DataLoader(
        val_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        collate_fn=collate_fn,
        num_workers=0,
    )

    device = select_device()
    model = PhonSSM().to(device)
    model.load_state_dict(torch.load(args.checkpoint, map_location=device))
    model.eval()

    triple_to_gloss = {value: gloss for gloss, value in PHONOLOGICAL_LABELS.items()}
    correct_h = correct_l = correct_m = correct_exact = total = 0
    focus_totals: Counter[str] = Counter()
    focus_correct: Counter[str] = Counter()
    focus_predictions: dict[str, Counter[str]] = defaultdict(Counter)
    gloss_totals: Counter[str] = Counter()
    gloss_correct: Counter[str] = Counter()
    gloss_predictions: dict[str, Counter[str]] = defaultdict(Counter)
    source_totals: Counter[str] = Counter()
    source_correct: Counter[str] = Counter()
    source_predictions: dict[str, Counter[str]] = defaultdict(Counter)
    source_handshape_correct: Counter[str] = Counter()
    source_location_correct: Counter[str] = Counter()
    source_movement_correct: Counter[str] = Counter()
    source_gloss_totals: dict[str, Counter[str]] = defaultdict(Counter)
    source_gloss_correct: dict[str, Counter[str]] = defaultdict(Counter)
    source_gloss_predictions: dict[str, dict[str, Counter[str]]] = defaultdict(
        lambda: defaultdict(Counter)
    )
    sample_index = 0

    with torch.no_grad():
        for batch in loader:
            outputs = model(batch["landmarks"].to(device))
            lengths = batch["input_lengths"].tolist()

            for index, length in enumerate(lengths):
                sample_path = Path(evaluated_paths[sample_index])
                identity = parse_sample_identity(sample_path)
                sample_index += 1
                predicted = (
                    strongest_nonblank(outputs["handshape"][index], length, 63),
                    strongest_nonblank(outputs["location"][index], length, 31),
                    strongest_nonblank(outputs["movement"][index], length, 31),
                )
                target = (
                    int(batch["handshape"][index].item()),
                    int(batch["location"][index].item()),
                    int(batch["movement"][index].item()),
                )

                correct_h += predicted[0] == target[0]
                correct_l += predicted[1] == target[1]
                correct_m += predicted[2] == target[2]
                correct_exact += predicted == target
                total += 1

                target_gloss = identity.gloss
                predicted_gloss = triple_to_gloss.get(predicted, str(predicted))
                is_correct = predicted == target
                gloss_totals[target_gloss] += 1
                gloss_correct[target_gloss] += is_correct
                gloss_predictions[target_gloss][predicted_gloss] += 1
                source_totals[identity.source] += 1
                source_correct[identity.source] += is_correct
                source_predictions[identity.source][predicted_gloss] += 1
                source_handshape_correct[identity.source] += predicted[0] == target[0]
                source_location_correct[identity.source] += predicted[1] == target[1]
                source_movement_correct[identity.source] += predicted[2] == target[2]
                source_gloss_totals[identity.source][target_gloss] += 1
                source_gloss_correct[identity.source][target_gloss] += is_correct
                source_gloss_predictions[identity.source][target_gloss][predicted_gloss] += 1
                if target_gloss in args.focus:
                    focus_totals[target_gloss] += 1
                    focus_correct[target_gloss] += is_correct
                    focus_predictions[target_gloss][predicted_gloss] += 1

    print(f"Checkpoint: {args.checkpoint}")
    print(f"Validation samples: {total}")
    print(
        "Accuracy: "
        f"handshape={correct_h / total:.1%} "
        f"location={correct_l / total:.1%} "
        f"movement={correct_m / total:.1%} "
        f"exact_gloss={correct_exact / total:.1%}"
    )
    for gloss in args.focus:
        gloss_total = focus_totals[gloss]
        focus_gloss_correct = focus_correct[gloss]
        accuracy = focus_gloss_correct / gloss_total if gloss_total else 0.0
        predictions = ", ".join(
            f"{prediction}:{count}"
            for prediction, count in focus_predictions[gloss].most_common(5)
        )
        print(
            f"{gloss}: {focus_gloss_correct}/{gloss_total} ({accuracy:.1%})"
            f" | top predictions: {predictions or 'none'}"
        )

    if args.output:
        checkpoint_path = Path(args.checkpoint)
        report = {
            "schema_version": 1,
            "checkpoint": str(checkpoint_path),
            "checkpoint_sha256": sha256_file(checkpoint_path),
            "data_dir": str(Path(args.data_dir).resolve()),
            "split": "all" if args.all_samples else "random_validation",
            "seed": args.seed,
            "validation_fraction": args.val_split,
            "samples": total,
            "accuracy": {
                "handshape": correct_h / total,
                "location": correct_l / total,
                "movement": correct_m / total,
                "exact_gloss": correct_exact / total,
            },
            "per_gloss": summarize_groups(gloss_totals, gloss_correct, gloss_predictions),
            "per_source": summarize_groups(source_totals, source_correct, source_predictions),
            "per_source_heads": {
                source: {
                    "samples": source_totals[source],
                    "handshape": source_handshape_correct[source] / source_totals[source],
                    "location": source_location_correct[source] / source_totals[source],
                    "movement": source_movement_correct[source] / source_totals[source],
                    "exact_gloss": source_correct[source] / source_totals[source],
                }
                for source in sorted(source_totals)
            },
            "per_source_gloss": {
                source: summarize_groups(
                    source_gloss_totals[source],
                    source_gloss_correct[source],
                    source_gloss_predictions[source],
                )
                for source in sorted(source_gloss_totals)
            },
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"Metrics written to {args.output}")


if __name__ == "__main__":
    main()
