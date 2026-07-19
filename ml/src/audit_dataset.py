"""Create a deterministic provenance and split-leakage audit for landmark data."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import unicodedata
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import torch

from convert_lsc50 import convert_sample
from lsc50_labels import LSC50_LABELS
from phonological_labels import PHONOLOGICAL_LABELS


@dataclass(frozen=True)
class SampleIdentity:
    source: str
    signer: str | None
    session: str | None
    gloss: str


def parse_sample_identity(path: Path) -> SampleIdentity:
    """Parse the two filename conventions used by landmarks_unified."""
    stem = path.stem
    if stem.startswith("LSC50_"):
        parts = stem.split("_", 3)
        if len(parts) == 4:
            _, signer, repetition, gloss = parts
            return SampleIdentity(
                source="LSC50",
                signer=f"LSC50:{signer}",
                session=f"LSC50:{signer}:{repetition}",
                gloss=gloss,
            )
    if stem.startswith("Per") and "_" in stem:
        signer, gloss = stem.split("_", 1)
        if signer[3:].isdigit():
            return SampleIdentity(
                source="LSC70",
                signer=f"LSC70:{signer}",
                session=None,
                gloss=gloss,
            )
    return SampleIdentity(
        source="UNKNOWN",
        signer=None,
        session=None,
        gloss=stem.split("_")[-1],
    )


def canonical_array_hash(array: np.ndarray, *, decimals: int | None = None) -> str:
    """Hash shape, dtype, and C-order values, optionally after decimal rounding."""
    canonical = np.ascontiguousarray(array)
    if decimals is not None and np.issubdtype(canonical.dtype, np.floating):
        canonical = np.ascontiguousarray(np.round(canonical.astype(np.float64), decimals))
    digest = hashlib.sha256()
    digest.update(str(canonical.shape).encode("ascii"))
    digest.update(canonical.dtype.str.encode("ascii"))
    digest.update(canonical.tobytes(order="C"))
    return digest.hexdigest()


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_gloss(gloss: str) -> str:
    decomposed = unicodedata.normalize("NFKD", gloss)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def lsc70_reference_path(repo_root: Path, path: Path) -> Path | None:
    for folder in ("landmarks_an", "landmarks_w"):
        candidate = repo_root / "LSC70" / "data" / folder / path.name
        if candidate.is_file():
            return candidate
    return None


def lsc50_source_descriptor(
    repo_root: Path, identity: SampleIdentity
) -> tuple[Path, str, str, str] | None:
    if identity.source != "LSC50" or identity.signer is None or identity.session is None:
        return None
    normalized_to_id = {normalize_gloss(gloss): sign_id for sign_id, gloss in LSC50_LABELS.items()}
    sign_id = normalized_to_id.get(normalize_gloss(identity.gloss))
    if sign_id is None:
        return None
    signer = identity.signer.rsplit(":", 1)[-1]
    repetition = identity.session.rsplit(":", 1)[-1]
    base = repo_root / "datasets" / "LSC50" / "LANDMARKS"
    return base, sign_id, signer, repetition


def lsc50_source_files(repo_root: Path, identity: SampleIdentity) -> list[Path]:
    descriptor = lsc50_source_descriptor(repo_root, identity)
    if descriptor is None:
        return []
    base, sign_id, signer, repetition = descriptor
    filename = f"{sign_id}_{signer}_{repetition}.csv"
    return [
        base / "BODY_LANDMARKS" / filename,
        base / "HANDS_LANDMARKS" / "LEFT_HAND_LANDMARKS" / filename,
        base / "HANDS_LANDMARKS" / "RIGHT_HAND_LANDMARKS" / filename,
        base / "FACE_LANDMARKS" / filename,
    ]


def percentile_summary(values: Iterable[int]) -> dict[str, float | int]:
    ordered = np.asarray(list(values), dtype=np.float64)
    if ordered.size == 0:
        return {"count": 0}
    return {
        "count": int(ordered.size),
        "min": int(ordered.min()),
        "p25": float(np.percentile(ordered, 25)),
        "median": float(np.median(ordered)),
        "mean": float(ordered.mean()),
        "p75": float(np.percentile(ordered, 75)),
        "max": int(ordered.max()),
    }


def duplicate_groups(records: list[dict[str, Any]], key: str) -> list[list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for record in records:
        groups[record[key]].append(record["path"])
    return sorted(
        (sorted(paths) for paths in groups.values() if len(paths) > 1),
        key=lambda paths: (-len(paths), paths[0]),
    )


def summarize_split(records: list[dict[str, Any]], seed: int, val_split: float) -> dict[str, Any]:
    generator = torch.Generator().manual_seed(seed)
    permutation = torch.randperm(len(records), generator=generator).tolist()
    val_size = int(len(records) * val_split)
    train_indices = set(permutation[: len(records) - val_size])
    val_indices = set(permutation[len(records) - val_size :])

    def values(indices: set[int], key: str) -> set[str]:
        return {str(records[index][key]) for index in indices if records[index][key] is not None}

    train_signers = values(train_indices, "signer")
    val_signers = values(val_indices, "signer")
    train_sessions = values(train_indices, "session")
    val_sessions = values(val_indices, "session")
    train_glosses = values(train_indices, "gloss")
    val_glosses = values(val_indices, "gloss")

    by_source: dict[str, Any] = {}
    for source in sorted({record["source"] for record in records}):
        source_train = {
            str(records[index]["signer"])
            for index in train_indices
            if records[index]["source"] == source and records[index]["signer"] is not None
        }
        source_val = {
            str(records[index]["signer"])
            for index in val_indices
            if records[index]["source"] == source and records[index]["signer"] is not None
        }
        by_source[source] = {
            "train_signers": len(source_train),
            "validation_signers": len(source_val),
            "shared_signers": len(source_train & source_val),
            "shared_signer_ids": sorted(source_train & source_val),
        }

    assignment = {
        record["path"]: "train" if index in train_indices else "validation"
        for index, record in enumerate(records)
    }
    cross_split_exact = 0
    for group in duplicate_groups(records, "array_sha256"):
        if len({assignment[path] for path in group}) > 1:
            cross_split_exact += 1

    val_gloss_counts = Counter(records[index]["gloss"] for index in val_indices)
    return {
        "seed": seed,
        "validation_fraction": val_split,
        "train_samples": len(train_indices),
        "validation_samples": len(val_indices),
        "train_signers": len(train_signers),
        "validation_signers": len(val_signers),
        "shared_signers": len(train_signers & val_signers),
        "shared_signer_ids": sorted(train_signers & val_signers),
        "shared_sessions": len(train_sessions & val_sessions),
        "shared_session_ids": sorted(train_sessions & val_sessions),
        "train_glosses": len(train_glosses),
        "validation_glosses": len(val_glosses),
        "validation_missing_glosses": sorted(train_glosses - val_glosses),
        "validation_gloss_counts": dict(sorted(val_gloss_counts.items())),
        "cross_split_exact_duplicate_groups": cross_split_exact,
        "by_source": by_source,
    }


def build_audit(
    data_dir: Path,
    repo_root: Path,
    artifact_paths: Iterable[Path] = (),
    *,
    seed: int = 42,
    val_split: float = 0.2,
) -> dict[str, Any]:
    records: list[dict[str, Any]] = []
    provenance: Counter[str] = Counter()

    for path in sorted(data_dir.glob("*.npy")):
        identity = parse_sample_identity(path)
        array = np.load(path, allow_pickle=False)
        is_valid_shape = array.ndim == 3 and array.shape[1:] == (543, 3)
        is_finite = bool(np.isfinite(array).all())
        record = {
            "path": path.name,
            **asdict(identity),
            "shape": list(array.shape),
            "dtype": str(array.dtype),
            "frames": int(array.shape[0]) if array.ndim > 0 else 0,
            "bytes": path.stat().st_size,
            "valid_shape": is_valid_shape,
            "finite": is_finite,
            "known_label": identity.gloss in PHONOLOGICAL_LABELS,
            "array_sha256": canonical_array_hash(array),
            "rounded_5dp_sha256": canonical_array_hash(array, decimals=5),
        }
        records.append(record)

        if identity.source == "LSC70":
            reference = lsc70_reference_path(repo_root, path)
            if reference is None:
                provenance["lsc70_reference_missing"] += 1
            elif canonical_array_hash(np.load(reference, allow_pickle=False)) == record["array_sha256"]:
                provenance["lsc70_reference_match"] += 1
            else:
                provenance["lsc70_reference_mismatch"] += 1
        elif identity.source == "LSC50":
            source_files = lsc50_source_files(repo_root, identity)
            if source_files and all(source_file.is_file() for source_file in source_files):
                provenance["lsc50_complete_csv_set"] += 1
                descriptor = lsc50_source_descriptor(repo_root, identity)
                assert descriptor is not None
                root, sign_id, signer, repetition = descriptor
                converted = convert_sample(str(root), sign_id, signer, repetition)
                if converted is not None and canonical_array_hash(converted) == record["array_sha256"]:
                    provenance["lsc50_reconstruction_match"] += 1
                else:
                    provenance["lsc50_reconstruction_mismatch"] += 1
            elif source_files:
                provenance["lsc50_incomplete_csv_set"] += 1
            else:
                provenance["lsc50_unmapped_gloss"] += 1
        else:
            provenance["unknown_source"] += 1

    valid_records = [record for record in records if record["known_label"]]
    by_source: dict[str, Any] = {}
    for source in sorted({record["source"] for record in records}):
        source_records = [record for record in records if record["source"] == source]
        by_source[source] = {
            "samples": len(source_records),
            "glosses": len({record["gloss"] for record in source_records}),
            "signers": len({record["signer"] for record in source_records if record["signer"]}),
            "sessions": len({record["session"] for record in source_records if record["session"]}),
            "frames": percentile_summary(record["frames"] for record in source_records),
        }

    by_gloss: dict[str, Any] = {}
    for gloss in sorted({record["gloss"] for record in valid_records}):
        gloss_records = [record for record in valid_records if record["gloss"] == gloss]
        by_gloss[gloss] = {
            "samples": len(gloss_records),
            "sources": dict(sorted(Counter(record["source"] for record in gloss_records).items())),
            "signers": len({record["signer"] for record in gloss_records if record["signer"]}),
            "frames": percentile_summary(record["frames"] for record in gloss_records),
        }

    manifest_payload = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    exact_groups = duplicate_groups(records, "array_sha256")
    rounded_groups = duplicate_groups(records, "rounded_5dp_sha256")
    exact_keys = {tuple(group) for group in exact_groups}
    near_only_groups = [group for group in rounded_groups if tuple(group) not in exact_keys]

    artifacts = {}
    for artifact in artifact_paths:
        resolved = artifact if artifact.is_absolute() else repo_root / artifact
        artifacts[str(artifact)] = {
            "exists": resolved.is_file(),
            "bytes": resolved.stat().st_size if resolved.is_file() else None,
            "sha256": file_hash(resolved) if resolved.is_file() else None,
        }

    return {
        "schema_version": 1,
        "data_dir": str(data_dir),
        "samples": records,
        "summary": {
            "files": len(records),
            "training_eligible_files": len(valid_records),
            "glosses": len({record["gloss"] for record in valid_records}),
            "signers": len({record["signer"] for record in valid_records if record["signer"]}),
            "invalid_shapes": sum(not record["valid_shape"] for record in records),
            "nonfinite_arrays": sum(not record["finite"] for record in records),
            "unknown_labels": sum(not record["known_label"] for record in records),
            "frames": percentile_summary(record["frames"] for record in valid_records),
            "manifest_sha256": hashlib.sha256(manifest_payload.encode("utf-8")).hexdigest(),
        },
        "by_source": by_source,
        "by_gloss": by_gloss,
        "provenance": dict(sorted(provenance.items())),
        "duplicates": {
            "exact_group_count": len(exact_groups),
            "exact_sample_count": sum(len(group) for group in exact_groups),
            "near_5dp_only_group_count": len(near_only_groups),
            "near_5dp_only_sample_count": sum(len(group) for group in near_only_groups),
            "exact_groups": exact_groups,
            "near_5dp_only_groups": near_only_groups,
        },
        "random_split": summarize_split(valid_records, seed, val_split),
        "artifacts": artifacts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("../datasets/landmarks_unified"))
    parser.add_argument("--repo-root", type=Path, default=Path(".."))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--artifact", action="append", default=[], type=Path)
    args = parser.parse_args()

    if not 0.0 < args.val_split < 1.0 or math.isnan(args.val_split):
        raise ValueError("--val-split must be between 0 and 1.")
    audit = build_audit(
        args.data_dir.resolve(),
        args.repo_root.resolve(),
        args.artifact,
        seed=args.seed,
        val_split=args.val_split,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(audit, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(audit["summary"], ensure_ascii=False, sort_keys=True))
    print(f"Audit written to {args.output}")


if __name__ == "__main__":
    main()
