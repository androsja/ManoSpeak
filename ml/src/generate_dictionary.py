"""
Generate mobile/assets/data/lsc_dictionary.json from a trained PhonSSM checkpoint.

For each sign in PHONOLOGICAL_LABELS, predicts (h, l, m) using the model on all
available training files for that gloss. The majority-vote triple is used as the
canonical dictionary key.

Outputs a JSON file mapping "h,l,m" → gloss string (Spanish).
"""

import os
import json
import argparse
import numpy as np
import torch
from collections import Counter
from model import PhonSSM
from normalizers import normalize_landmarks
from phonological_labels import PHONOLOGICAL_LABELS


def load_model(model_path: str, device: torch.device) -> PhonSSM:
    model = PhonSSM()
    if os.path.exists(model_path):
        model.load_state_dict(torch.load(model_path, map_location="cpu"))
        print(f"Loaded checkpoint: {model_path}")
    else:
        print(f"WARNING: checkpoint not found at {model_path}. Using random weights.")
    model.eval()
    return model.to(device)


def predict_triple(model: PhonSSM, landmarks_path: str, device: torch.device) -> tuple[int, int, int]:
    """Run model on a single .npy file, return argmax (h, l, m)."""
    landmarks: np.ndarray = np.load(landmarks_path)
    landmarks = normalize_landmarks(landmarks)
    tensor = torch.tensor(landmarks, dtype=torch.float32).unsqueeze(0).to(device)

    with torch.no_grad():
        out = model(tensor)

    h = int(out["handshape"].argmax(dim=1).item())
    l = int(out["location"].argmax(dim=1).item())
    m = int(out["movement"].argmax(dim=1).item())
    return (h, l, m)


def extract_gloss(file_path: str) -> str:
    stem = os.path.splitext(os.path.basename(file_path))[0]
    return stem.split("_")[-1]


def select_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate lsc_dictionary.json from trained PhonSSM.")
    parser.add_argument("--model_path",  default="checkpoints/best_model.pt")
    parser.add_argument("--data_dir",    default="../datasets/landmarks_unified")
    parser.add_argument("--output_path", default="../mobile/assets/data/lsc_dictionary.json")
    args = parser.parse_args()

    device = select_device()
    print(f"Device: {device}")
    model = load_model(args.model_path, device)

    # Group files by gloss
    files_by_gloss: dict[str, list[str]] = {}
    for fname in os.listdir(args.data_dir):
        if not fname.endswith(".npy"):
            continue
        gloss = extract_gloss(fname)
        if gloss in PHONOLOGICAL_LABELS:
            files_by_gloss.setdefault(gloss, []).append(os.path.join(args.data_dir, fname))

    # Predict and vote for each gloss
    dictionary: dict[str, str] = {}
    ground_truth_hits = 0

    for gloss in sorted(files_by_gloss.keys()):
        files = files_by_gloss[gloss]
        votes: Counter[tuple[int, int, int]] = Counter()
        for fp in files:
            try:
                triple = predict_triple(model, fp, device)
                votes[triple] += 1
            except Exception as e:
                print(f"  Warning: failed on {fp}: {e}")

        if not votes:
            continue

        pred_triple = votes.most_common(1)[0][0]
        gt_triple = PHONOLOGICAL_LABELS[gloss]
        key = f"{pred_triple[0]},{pred_triple[1]},{pred_triple[2]}"
        dictionary[key] = gloss

        gt_match = "✓" if pred_triple == gt_triple else f"✗ (gt={gt_triple})"
        top_count, total = votes.most_common(1)[0][1], sum(votes.values())
        print(f"  {gloss:<20} pred={pred_triple}  {gt_match}  confidence={top_count/total:.0%} ({len(files)} files)")
        if pred_triple == gt_triple:
            ground_truth_hits += 1

    accuracy = ground_truth_hits / len(files_by_gloss) if files_by_gloss else 0.0
    print(f"\nGround-truth match rate: {ground_truth_hits}/{len(files_by_gloss)} = {accuracy:.1%}")

    os.makedirs(os.path.dirname(args.output_path), exist_ok=True)
    with open(args.output_path, "w", encoding="utf-8") as f:
        json.dump(dictionary, f, ensure_ascii=False, indent=2, sort_keys=True)

    print(f"\nDictionary written: {args.output_path}  ({len(dictionary)} entries)")


if __name__ == "__main__":
    main()
