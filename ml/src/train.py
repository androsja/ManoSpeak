import os
import argparse
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader, random_split
from model import PhonSSM
from normalizers import normalize_landmarks, apply_gaussian_jitter, apply_time_warping, apply_micro_scaling
from phonological_labels import PHONOLOGICAL_LABELS


class LSCDataset(Dataset):
    """
    Dataset loading LSC landmark .npy files from a directory.

    Label resolution uses PHONOLOGICAL_LABELS:
      file stem → gloss → (handshape, location, movement)
    Files whose gloss is not in PHONOLOGICAL_LABELS are silently skipped.
    """

    def __init__(self, landmarks_dir: str, augment: bool = False) -> None:
        self.landmarks_dir = landmarks_dir
        self.augment = augment

        all_files = [
            os.path.join(landmarks_dir, f)
            for f in os.listdir(landmarks_dir)
            if f.endswith(".npy")
        ]

        # Keep only files whose gloss maps to a phonological label
        self.file_paths: list[str] = []
        for fp in all_files:
            gloss = self._extract_gloss(fp)
            if gloss in PHONOLOGICAL_LABELS:
                self.file_paths.append(fp)

        self.file_paths.sort()
        skipped = len(all_files) - len(self.file_paths)
        if skipped:
            print(f"  [Dataset] Skipped {skipped} files with unknown glosses.")
        print(f"  [Dataset] Loaded {len(self.file_paths)} files, {len(PHONOLOGICAL_LABELS)} sign classes.")

    @staticmethod
    def _extract_gloss(file_path: str) -> str:
        stem = os.path.splitext(os.path.basename(file_path))[0]
        return stem.split("_")[-1]

    def __len__(self) -> int:
        return len(self.file_paths)

    def __getitem__(self, idx: int) -> dict:
        file_path = self.file_paths[idx]
        landmarks: np.ndarray = np.load(file_path)

        gloss = self._extract_gloss(file_path)
        h, l, m = PHONOLOGICAL_LABELS[gloss]

        # Step 1: normalize (mirrors mobile LandmarkNormalizer)
        landmarks = normalize_landmarks(landmarks)

        # Step 2: Sim2Real augmentations (training only)
        if self.augment:
            if np.random.rand() < 0.5:
                landmarks = apply_gaussian_jitter(landmarks, sigma=0.02)
            if np.random.rand() < 0.5:
                warp_factor = float(np.random.uniform(0.85, 1.15))
                landmarks = apply_time_warping(landmarks, warp_factor=warp_factor)
            if np.random.rand() < 0.5:
                landmarks = apply_micro_scaling(landmarks)

        return {
            "landmarks": torch.tensor(landmarks, dtype=torch.float32),
            "handshape": torch.tensor(h, dtype=torch.long),
            "location":  torch.tensor(l, dtype=torch.long),
            "movement":  torch.tensor(m, dtype=torch.long),
        }


def collate_fn(batch: list[dict]) -> dict:
    """Pad variable-length temporal sequences to the longest in the batch."""
    landmarks_list = [item["landmarks"] for item in batch]
    max_len = max(lm.shape[0] for lm in landmarks_list)

    padded = []
    for lm in landmarks_list:
        pad_size = max_len - lm.shape[0]
        if pad_size > 0:
            pad = torch.zeros((pad_size, 543, 3), dtype=torch.float32)
            padded.append(torch.cat([lm, pad], dim=0))
        else:
            padded.append(lm)

    return {
        "landmarks": torch.stack(padded, dim=0),
        "handshape": torch.stack([item["handshape"] for item in batch]),
        "location":  torch.stack([item["location"]  for item in batch]),
        "movement":  torch.stack([item["movement"]  for item in batch]),
    }


def select_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def run_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
    optimizer: optim.Optimizer | None = None,
) -> tuple[float, float, float, float]:
    """Run one epoch. Returns (total_loss, h_acc, l_acc, m_acc)."""
    training = optimizer is not None
    model.train(training)

    total_loss = 0.0
    correct_h = correct_l = correct_m = total = 0

    with torch.set_grad_enabled(training):
        for batch in loader:
            lm = batch["landmarks"].to(device)
            t_h = batch["handshape"].to(device)
            t_l = batch["location"].to(device)
            t_m = batch["movement"].to(device)

            if training:
                optimizer.zero_grad()

            out = model(lm)
            loss = criterion(out["handshape"], t_h) + criterion(out["location"], t_l) + criterion(out["movement"], t_m)

            if training:
                loss.backward()
                optimizer.step()

            total_loss += loss.item()
            correct_h += (out["handshape"].argmax(dim=1) == t_h).sum().item()
            correct_l += (out["location"].argmax(dim=1)  == t_l).sum().item()
            correct_m += (out["movement"].argmax(dim=1)  == t_m).sum().item()
            total += t_h.size(0)

    n = len(loader)
    return (
        total_loss / n,
        correct_h / total,
        correct_l / total,
        correct_m / total,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Train PhonSSM on LSC landmarks.")
    parser.add_argument("--data_dir",      default="../datasets/landmarks_unified")
    parser.add_argument("--epochs",        type=int,   default=50)
    parser.add_argument("--batch_size",    type=int,   default=16)
    parser.add_argument("--lr",            type=float, default=1e-3)
    parser.add_argument("--val_split",     type=float, default=0.2)
    parser.add_argument("--checkpoint_dir", default="checkpoints")
    parser.add_argument("--seed",          type=int,   default=42)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    os.makedirs(args.checkpoint_dir, exist_ok=True)

    if not os.path.exists(args.data_dir) or not os.listdir(args.data_dir):
        print(f"Error: No landmarks found in {args.data_dir}")
        return

    print(f"Loading dataset from: {args.data_dir}")
    full_dataset = LSCDataset(args.data_dir, augment=False)

    val_size = int(len(full_dataset) * args.val_split)
    train_size = len(full_dataset) - val_size
    train_ds, val_ds = random_split(full_dataset, [train_size, val_size], generator=torch.Generator().manual_seed(args.seed))

    # Enable augmentations on training subset only
    train_ds.dataset.augment = True  # type: ignore[attr-defined]

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True,  collate_fn=collate_fn, num_workers=0)
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size, shuffle=False, collate_fn=collate_fn, num_workers=0)

    device = select_device()
    print(f"Device: {device} | Train: {train_size} | Val: {val_size}")

    model = PhonSSM().to(device)
    optimizer = optim.Adam(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="min", factor=0.5, patience=5)
    criterion = nn.CrossEntropyLoss()

    best_val_loss = float("inf")
    best_path = os.path.join(args.checkpoint_dir, "best_model.pt")

    print(f"\nStarting training — {args.epochs} epochs\n{'-'*60}")
    for epoch in range(1, args.epochs + 1):
        tr_loss, tr_h, tr_l, tr_m = run_epoch(model, train_loader, criterion, device, optimizer)
        vl_loss, vl_h, vl_l, vl_m = run_epoch(model, val_loader,   criterion, device)

        scheduler.step(vl_loss)

        flag = ""
        if vl_loss < best_val_loss:
            best_val_loss = vl_loss
            torch.save(model.state_dict(), best_path)
            flag = " ← best"

        print(
            f"Epoch {epoch:3d}/{args.epochs}  "
            f"tr_loss={tr_loss:.4f}  vl_loss={vl_loss:.4f}  "
            f"acc(h/l/m): {vl_h:.2%}/{vl_l:.2%}/{vl_m:.2%}{flag}"
        )

    print(f"\nBest checkpoint saved → {best_path}  (val_loss={best_val_loss:.4f})")


if __name__ == "__main__":
    main()
