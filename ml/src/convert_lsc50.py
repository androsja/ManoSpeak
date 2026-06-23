"""
Convert LSC50 CSV landmarks to .npy arrays compatible with the PhonSSM training pipeline.

LSC50 file naming: {sign_id}_{signer_id}_{repetition}.csv  (0000-0049, 0000-0004, 0000-0003)
Output naming:     LSC50_{signer}_{rep}_{sign_id}.npy
                   (last segment after _ is the word label used by LSCDataset in train.py)

Landmark order to match MediaPipe Holistic (543 total):
  0-32   : 33 body landmarks  (BODY_LANDMARKS)
  33-53  : 21 left-hand landmarks  (HANDS_LANDMARKS/LEFT_HAND_LANDMARKS)
  54-74  : 21 right-hand landmarks (HANDS_LANDMARKS/RIGHT_HAND_LANDMARKS)
  75-542 : 468 face landmarks  (FACE_LANDMARKS)

BODY and HANDS run at ~30 fps; FACE may be at a higher rate — we resample to body frame count.
"""

import os
import argparse
import numpy as np
import pandas as pd
from scipy.interpolate import interp1d


BODY_DIR = "BODY_LANDMARKS"
LEFT_HAND_DIR = os.path.join("HANDS_LANDMARKS", "LEFT_HAND_LANDMARKS")
RIGHT_HAND_DIR = os.path.join("HANDS_LANDMARKS", "RIGHT_HAND_LANDMARKS")
FACE_DIR = "FACE_LANDMARKS"


def load_csv_as_array(path: str, n_landmarks: int) -> np.ndarray:
    """Load a CSV file into shape (frames, n_landmarks, 3)."""
    df = pd.read_csv(path, index_col=0)
    frames = df.shape[0]
    arr = df.values.reshape(frames, n_landmarks, 3)
    return arr.astype(np.float32)


def resample_to_n_frames(arr: np.ndarray, target_frames: int) -> np.ndarray:
    """Resample a (frames, landmarks, 3) array to target_frames via linear interpolation."""
    src_frames = arr.shape[0]
    if src_frames == target_frames:
        return arr
    x_old = np.linspace(0, 1, src_frames)
    x_new = np.linspace(0, 1, target_frames)
    interp = interp1d(x_old, arr, axis=0, kind="linear")
    return interp(x_new).astype(np.float32)


def convert_sample(landmarks_root: str, sign_id: str, signer_id: str, rep_id: str) -> np.ndarray | None:
    """Combine body + hands + face CSVs into a single (frames, 543, 3) array."""
    fname = f"{sign_id}_{signer_id}_{rep_id}.csv"

    body_path = os.path.join(landmarks_root, BODY_DIR, fname)
    lh_path = os.path.join(landmarks_root, LEFT_HAND_DIR, fname)
    rh_path = os.path.join(landmarks_root, RIGHT_HAND_DIR, fname)
    face_path = os.path.join(landmarks_root, FACE_DIR, fname)

    for p in [body_path, lh_path, rh_path, face_path]:
        if not os.path.exists(p):
            return None

    body = load_csv_as_array(body_path, 33)    # (frames, 33, 3)
    lh   = load_csv_as_array(lh_path,   21)   # (frames, 21, 3)
    rh   = load_csv_as_array(rh_path,   21)   # (frames, 21, 3)
    face = load_csv_as_array(face_path, 468)  # (frames, 468, 3)

    # Use body frame count as temporal reference
    target_frames = body.shape[0]
    lh   = resample_to_n_frames(lh,   target_frames)
    rh   = resample_to_n_frames(rh,   target_frames)
    face = resample_to_n_frames(face, target_frames)

    # Concatenate along landmark axis → (frames, 543, 3)
    combined = np.concatenate([body, lh, rh, face], axis=1)
    assert combined.shape[1] == 543, f"Expected 543 landmarks, got {combined.shape[1]}"
    return combined


def main():
    parser = argparse.ArgumentParser(description="Convert LSC50 CSVs to PhonSSM-compatible .npy files.")
    parser.add_argument("--landmarks_root", type=str,
                        default="../../datasets/LSC50/LANDMARKS",
                        help="Path to the LSC50 LANDMARKS/ directory")
    parser.add_argument("--output_dir", type=str,
                        default="../../datasets/landmarks_unified",
                        help="Output directory for .npy files")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    body_dir = os.path.join(args.landmarks_root, BODY_DIR)
    all_files = [f for f in os.listdir(body_dir) if f.endswith(".csv")]

    success, skipped = 0, 0
    for fname in sorted(all_files):
        stem = os.path.splitext(fname)[0]          # e.g. 0001_0002_0003
        parts = stem.split("_")
        sign_id, signer_id, rep_id = parts[0], parts[1], parts[2]

        landmarks = convert_sample(args.landmarks_root, sign_id, signer_id, rep_id)
        if landmarks is None:
            skipped += 1
            continue

        # Filename: LSC50_{signer}_{rep}_{sign_id}.npy
        # train.py splits on '_' and takes the LAST segment as the word label → sign_id
        out_name = f"LSC50_{signer_id}_{rep_id}_{sign_id}.npy"
        out_path = os.path.join(args.output_dir, out_name)
        np.save(out_path, landmarks)
        success += 1

    print(f"Done. Converted: {success}, Skipped: {skipped}")
    print(f"Output: {os.path.abspath(args.output_dir)}")


if __name__ == "__main__":
    main()
