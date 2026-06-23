"""
Unit tests for phonological_labels.py:
  - All 94 glosses present
  - All (h, l, m) triples are unique
  - All values within PhonSSM head bounds
  - Label extraction from filename works correctly
"""

import os
import tempfile
import numpy as np
import pytest
from src.phonological_labels import PHONOLOGICAL_LABELS
from src.train import LSCDataset


EXPECTED_GLOSSES = {
    # Digits
    "1", "4", "5", "6", "7", "8", "9", "10",
    # Letters
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "NN", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    # Word-numbers
    "MIL", "MILLON", "ANNOS",
    # LSC words
    "HOLA", "ADIOS", "BIEN", "YO", "TU", "USTEDES", "QUIEN",
    "GRACIAS", "PORFAVOR", "PERDON", "CONGUSTO",
    "MUCHO", "POCO", "TODOS", "FAMILIA", "DIFERENTE", "PERSONAS",
    "COMER", "HAMBRE", "GUSTAR",
    "MAL", "CONTENTO", "FELIZ", "ABURRIDO",
    "COMO", "COMOESTAS", "QUE", "DONDE", "CUANDO",
    "PORQUE", "MASOMENOS", "NUNCA",
    "JUCIOSO", "HOMBRE", "MUJER",
    "TRISTE", "SENTIR",
    "ABUELO", "TIO", "HERMANO",
    "NIÑO", "NIÑA",
    "NOMBRE", "SEÑA", "PERMISO",
    "BUENAS", "DIAS", "NOCHES",
    "BUENOSDIAS", "BUENASTARDES", "BUENASNOCHES", "TARDES",
    "TRABAJAR", "VIVIR", "LICOR",
    "BIENVENIDO",
}


class TestPhonologicalLabels:
    def test_total_count(self) -> None:
        assert len(PHONOLOGICAL_LABELS) == 94

    def test_all_expected_glosses_present(self) -> None:
        missing = EXPECTED_GLOSSES - set(PHONOLOGICAL_LABELS.keys())
        assert not missing, f"Missing glosses: {missing}"

    def test_no_extra_glosses(self) -> None:
        extra = set(PHONOLOGICAL_LABELS.keys()) - EXPECTED_GLOSSES
        assert not extra, f"Unexpected glosses: {extra}"

    def test_all_triples_unique(self) -> None:
        triples = list(PHONOLOGICAL_LABELS.values())
        assert len(triples) == len(set(triples)), "Duplicate (h, l, m) triples found"

    def test_handshape_bounds(self) -> None:
        for gloss, (h, l, m) in PHONOLOGICAL_LABELS.items():
            assert 0 <= h <= 63, f"{gloss}: h={h} out of [0,63]"

    def test_location_bounds(self) -> None:
        for gloss, (h, l, m) in PHONOLOGICAL_LABELS.items():
            assert 0 <= l <= 31, f"{gloss}: l={l} out of [0,31]"

    def test_movement_bounds(self) -> None:
        for gloss, (h, l, m) in PHONOLOGICAL_LABELS.items():
            assert 0 <= m <= 31, f"{gloss}: m={m} out of [0,31]"

    def test_letters_all_in_dactylology_space(self) -> None:
        for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
            h, l, m = PHONOLOGICAL_LABELS[letter]
            assert l == 16, f"Letter '{letter}' has l={l}, expected 16 (dactylology space)"

    def test_nn_in_dactylology_space(self) -> None:
        h, l, m = PHONOLOGICAL_LABELS["NN"]
        assert l == 16

    def test_digits_in_dactylology_space(self) -> None:
        for digit in ["1", "4", "5", "6", "7", "8", "9", "10"]:
            h, l, m = PHONOLOGICAL_LABELS[digit]
            assert l == 16, f"Digit '{digit}' has l={l}, expected 16"

    def test_j_and_z_have_trace_movement(self) -> None:
        assert PHONOLOGICAL_LABELS["J"][2] == 12, "J should have m=12 (trace)"
        assert PHONOLOGICAL_LABELS["Z"][2] == 12, "Z should have m=12 (trace)"

    def test_yo_points_to_chest(self) -> None:
        h, l, m = PHONOLOGICAL_LABELS["YO"]
        assert l == 9, "YO should point to chest (l=9)"
        assert m == 0, "YO is a static point (m=0)"


class TestLSCDatasetLabelExtraction:
    def test_extract_gloss_lsc50_format(self) -> None:
        # LSC50_0000_0000_ADIOS.npy → "ADIOS"
        gloss = LSCDataset._extract_gloss("some/path/LSC50_0000_0000_ADIOS.npy")
        assert gloss == "ADIOS"

    def test_extract_gloss_per_format(self) -> None:
        # Per04_HOLA.npy → "HOLA"
        gloss = LSCDataset._extract_gloss("some/path/Per04_HOLA.npy")
        assert gloss == "HOLA"

    def test_extract_gloss_letter(self) -> None:
        # Per25_A.npy → "A"
        gloss = LSCDataset._extract_gloss("Per25_A.npy")
        assert gloss == "A"

    def test_extract_gloss_nn(self) -> None:
        # Per08_NN.npy → "NN"
        gloss = LSCDataset._extract_gloss("Per08_NN.npy")
        assert gloss == "NN"

    def test_extract_gloss_number(self) -> None:
        gloss = LSCDataset._extract_gloss("Per34_10.npy")
        assert gloss == "10"

    def test_dataset_getitem_returns_correct_label(self) -> None:
        """Integration: load a synthetic npy file and verify (h,l,m) labels."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a synthetic HOLA file: 10 frames × 543 × 3
            fake_landmarks = np.zeros((10, 543, 3), dtype=np.float32)
            # Add left/right shoulders so normalization has a reference
            fake_landmarks[:, 11] = [0.4, 0.5, 0.0]
            fake_landmarks[:, 12] = [0.6, 0.5, 0.0]
            np.save(os.path.join(tmpdir, "Per99_HOLA.npy"), fake_landmarks)

            ds = LSCDataset(tmpdir, augment=False)
            assert len(ds) == 1

            item = ds[0]
            expected_h, expected_l, expected_m = PHONOLOGICAL_LABELS["HOLA"]
            assert item["handshape"].item() == expected_h
            assert item["location"].item()  == expected_l
            assert item["movement"].item()  == expected_m
            assert item["landmarks"].shape[1] == 543
            assert item["landmarks"].shape[2] == 3

    def test_dataset_skips_unknown_glosses(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a file with an unknown gloss
            np.save(os.path.join(tmpdir, "Per99_UNKNOWNGLOSS.npy"), np.zeros((5, 543, 3)))
            # Create a valid file
            np.save(os.path.join(tmpdir, "Per99_HOLA.npy"), np.zeros((5, 543, 3)))

            ds = LSCDataset(tmpdir, augment=False)
            assert len(ds) == 1  # only HOLA survives
