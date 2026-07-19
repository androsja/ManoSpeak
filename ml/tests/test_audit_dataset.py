import json
from pathlib import Path

import numpy as np

from src.audit_dataset import (
    build_audit,
    canonical_array_hash,
    parse_sample_identity,
)


def save_sample(path: Path, value: float) -> None:
    np.save(path, np.full((6, 543, 3), value, dtype=np.float32))


def test_parse_sample_identity_preserves_source_signer_and_session() -> None:
    lsc50 = parse_sample_identity(Path("LSC50_0002_0003_HOLA.npy"))
    lsc70 = parse_sample_identity(Path("Per07_HOLA.npy"))

    assert lsc50.source == "LSC50"
    assert lsc50.signer == "LSC50:0002"
    assert lsc50.session == "LSC50:0002:0003"
    assert lsc50.gloss == "HOLA"
    assert lsc70.source == "LSC70"
    assert lsc70.signer == "LSC70:Per07"
    assert lsc70.session is None


def test_canonical_hash_can_identify_rounded_near_duplicates() -> None:
    first = np.zeros((1, 543, 3), dtype=np.float32)
    second = first.copy()
    second[0, 0, 0] = 0.000001

    assert canonical_array_hash(first) != canonical_array_hash(second)
    assert canonical_array_hash(first, decimals=5) == canonical_array_hash(second, decimals=5)


def test_build_audit_is_deterministic_and_reports_signer_leakage(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    save_sample(data_dir / "Per01_HOLA.npy", 0.0)
    save_sample(data_dir / "Per01_YO.npy", 1.0)
    save_sample(data_dir / "Per02_HOLA.npy", 2.0)
    save_sample(data_dir / "Per02_YO.npy", 3.0)
    save_sample(data_dir / "Per03_HOLA.npy", 4.0)

    first = build_audit(data_dir, tmp_path, seed=42, val_split=0.4)
    second = build_audit(data_dir, tmp_path, seed=42, val_split=0.4)

    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert first["summary"]["files"] == 5
    assert first["summary"]["invalid_shapes"] == 0
    assert first["random_split"]["train_samples"] == 3
    assert first["random_split"]["validation_samples"] == 2
