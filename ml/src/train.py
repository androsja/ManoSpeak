# ruff: noqa: E402
import argparse
import os
from typing import Any

os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import ConcatDataset, DataLoader, Dataset, Subset, WeightedRandomSampler
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
        handshape, location, movement = PHONOLOGICAL_LABELS[gloss]

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
            # NOTE: horizontal-flip augmentation is disabled. A correct mirror
            # must negate X on non-zero landmarks (data is centered in [-1, 1])
            # AND swap the left/right hand landmark blocks; the previous
            # `1.0 - x` version corrupted coordinates and the zero mask.

        return {
            "landmarks": torch.tensor(landmarks, dtype=torch.float32),
            "handshape": torch.tensor(handshape, dtype=torch.long),
            "location":  torch.tensor(location, dtype=torch.long),
            "movement":  torch.tensor(movement, dtype=torch.long),
        }


def _flip_horizontal(landmarks: np.ndarray) -> np.ndarray:
    """
    Mirror the X coordinate of every landmark.
    Shape: (T, 543, 3) — X channel is index 0.
    This simulates a left-handed signer seen in mirror, doubling coverage
    for static handshapes without requiring extra recordings.
    """
    flipped = landmarks.copy()
    flipped[:, :, 0] = 1.0 - flipped[:, :, 0]   # X ∈ [0,1] after normalization
    return flipped


def collate_fn(batch: list[dict]) -> dict:
    """Pad variable-length temporal sequences to the longest in the batch."""
    landmarks_list = [item["landmarks"] for item in batch]
    input_lengths = torch.tensor([lm.shape[0] for lm in landmarks_list], dtype=torch.long)
    max_len = input_lengths.max().item()

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
        "input_lengths": input_lengths,
        "handshape": torch.tensor([item["handshape"] for item in batch], dtype=torch.long),
        "location":  torch.tensor([item["location"]  for item in batch], dtype=torch.long),
        "movement":  torch.tensor([item["movement"]  for item in batch], dtype=torch.long),
    }


def compute_class_weights(dataset: Dataset, num_classes: int, label_key: str) -> torch.Tensor:
    """
    Compute inverse-frequency class weights from the full dataset.
    Returns a tensor of shape (num_classes,) suitable for CrossEntropyLoss(weight=...).
    """
    counts = torch.zeros(num_classes, dtype=torch.float32)
    for i in range(len(dataset)):  # type: ignore[arg-type]
        label = dataset[i][label_key].item()
        counts[label] += 1.0

    present = counts > 0
    weights = torch.zeros_like(counts)
    weights[present] = torch.sqrt(
        counts[present].sum() / (present.sum() * counts[present])
    )
    return weights


def compute_gloss_balancing_weights(dataset: Dataset) -> list[float]:
    """Return inverse-frequency sample weights so every gloss is sampled equally."""
    glosses = dataset_glosses(dataset)
    counts: dict[str, int] = {}
    for gloss in glosses:
        counts[gloss] = counts.get(gloss, 0) + 1
    return [1.0 / counts[gloss] for gloss in glosses]


def dataset_glosses(dataset: Dataset) -> list[str]:
    """Resolve glosses without loading or augmenting landmark arrays."""
    if isinstance(dataset, LSCDataset):
        return [dataset._extract_gloss(path) for path in dataset.file_paths]
    if isinstance(dataset, Subset):
        base_glosses = dataset_glosses(dataset.dataset)
        return [base_glosses[index] for index in dataset.indices]
    if isinstance(dataset, ConcatDataset):
        return [
            gloss
            for child_dataset in dataset.datasets
            for gloss in dataset_glosses(child_dataset)
        ]
    raise TypeError(f"Unsupported dataset type for gloss balancing: {type(dataset).__name__}")


def pool_valid_nonblank_logits(
    logits: torch.Tensor,
    input_lengths: torch.Tensor,
    blank_index: int,
) -> torch.Tensor:
    """Max-pool non-blank logits over each sample's unpadded frames."""
    nonblank = logits[..., :blank_index]
    time = torch.arange(nonblank.size(1), device=nonblank.device).unsqueeze(0)
    padding_mask = time >= input_lengths.unsqueeze(1)
    return nonblank.masked_fill(padding_mask.unsqueeze(2), float("-inf")).max(dim=1).values


def select_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def run_epoch(
    model: nn.Module,
    loader: DataLoader,
    h_criterion: nn.Module,
    lm_criterion: nn.Module,
    device: torch.device,
    optimizer: optim.Optimizer | None = None,
    auxiliary_criteria: tuple[nn.Module, nn.Module, nn.Module] | None = None,
    auxiliary_weight: float = 0.0,
) -> tuple[float, float, float, float]:
    """
    Run one epoch.
    h_criterion  — weighted CE for handshape (harder task).
    lm_criterion — standard CE for location and movement.
    Returns (total_loss, h_acc, l_acc, m_acc).
    """
    training = optimizer is not None
    model.train(training)

    total_loss = 0.0
    correct_h = correct_l = correct_m = total = 0

    with torch.set_grad_enabled(training):
        for batch in loader:
            lm = batch["landmarks"].to(device)
            input_lengths = batch["input_lengths"].to(device)
            t_h = batch["handshape"].to(device)
            t_l = batch["location"].to(device)
            t_m = batch["movement"].to(device)
            
            # Isolated sign clip: target sequence length is exactly 1 token
            target_lengths = torch.ones(lm.size(0), dtype=torch.long).to(device)

            if optimizer is not None:
                optimizer.zero_grad()

            out = model(lm)
            
            # CTC loss expects log-probabilities of shape (T, B, C)
            log_h = out["handshape"].log_softmax(2).transpose(0, 1)
            log_l = out["location"].log_softmax(2).transpose(0, 1)
            log_m = out["movement"].log_softmax(2).transpose(0, 1)

            loss = (
                h_criterion(log_h, t_h, input_lengths, target_lengths)
                + lm_criterion(log_l, t_l, input_lengths, target_lengths)
                + lm_criterion(log_m, t_m, input_lengths, target_lengths)
            )

            pooled_h = pool_valid_nonblank_logits(out["handshape"], input_lengths, 63)
            pooled_l = pool_valid_nonblank_logits(out["location"], input_lengths, 31)
            pooled_m = pool_valid_nonblank_logits(out["movement"], input_lengths, 31)
            if auxiliary_criteria is not None and auxiliary_weight > 0:
                aux_h, aux_l, aux_m = auxiliary_criteria
                loss = loss + auxiliary_weight * (
                    aux_h(pooled_h, t_h)
                    + aux_l(pooled_l, t_l)
                    + aux_m(pooled_m, t_m)
                )

            if optimizer is not None:
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()

            total_loss += loss.item()
            
            # Accuracy proxy for isolated signs: strongest NON-blank class over time.
            # CTC makes the model peaky on the blank token (index 63 for handshape,
            # 31 for loc/mov), so the blank column must be excluded or the metric
            # always predicts blank and reads ~0%. This mirrors the mobile decoder,
            # which discards those same blank indices.
            correct_h += (pooled_h.argmax(dim=1) == t_h).sum().item()
            correct_l += (pooled_l.argmax(dim=1) == t_l).sum().item()
            correct_m += (pooled_m.argmax(dim=1) == t_m).sum().item()
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
    parser.add_argument("--data_dir",       default="../datasets/landmarks_unified")
    parser.add_argument("--epochs",         type=int,   default=100)
    parser.add_argument("--batch_size",     type=int,   default=16)
    parser.add_argument("--lr",             type=float, default=1e-3)
    parser.add_argument("--val_split",      type=float, default=0.2)
    parser.add_argument("--checkpoint_dir", default="checkpoints")
    parser.add_argument(
        "--extra_train_dir",
        help="Optional directory of training-only personalization .npy samples.",
    )
    parser.add_argument("--seed",           type=int,   default=42)
    parser.add_argument(
        "--aux_weight",
        type=float,
        default=0.5,
        help="Weight for class-balanced sequence classification loss.",
    )
    parser.add_argument(
        "--resume_from",
        help="Checkpoint containing model weights to resume from.",
    )
    parser.add_argument(
        "--start_epoch",
        type=int,
        default=0,
        help="Number of completed epochs before this run (for logging only).",
    )
    parser.add_argument(
        "--best_val_loss",
        type=float,
        default=float("inf"),
        help="Best validation loss from the previous run when resuming.",
    )
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    os.makedirs(args.checkpoint_dir, exist_ok=True)

    if not os.path.exists(args.data_dir) or not os.listdir(args.data_dir):
        print(f"Error: No landmarks found in {args.data_dir}")
        return

    print(f"Loading dataset from: {args.data_dir}")
    # Two views over the SAME files: the training view is augmented, the
    # validation view is not. random_split Subsets share one underlying
    # dataset object, so toggling `.augment` on it would leak augmentation
    # into validation and make val metrics (and best-checkpoint selection)
    # unreliable — hence two separate instances split by the same indices.
    train_full = LSCDataset(args.data_dir, augment=True)
    val_full   = LSCDataset(args.data_dir, augment=False)

    n_samples  = len(train_full)
    val_size   = int(n_samples * args.val_split)
    train_size = n_samples - val_size
    perm = torch.randperm(
        n_samples, generator=torch.Generator().manual_seed(args.seed)
    ).tolist()
    base_train_ds = Subset(train_full, perm[:train_size])
    val_ds   = Subset(val_full,   perm[train_size:])
    train_parts: list[Dataset] = [base_train_ds]
    if args.extra_train_dir:
        extra_train_ds = LSCDataset(args.extra_train_dir, augment=True)
        if len(extra_train_ds) == 0:
            raise ValueError("No valid personalization samples found in extra_train_dir.")
        train_parts.append(extra_train_ds)
        print(f"Personalization train samples: {len(extra_train_ds)}")
    train_ds: ConcatDataset[Any] = ConcatDataset(train_parts)

    train_sampler = WeightedRandomSampler(
        compute_gloss_balancing_weights(train_ds),
        num_samples=len(train_ds),
        replacement=True,
        generator=torch.Generator().manual_seed(args.seed),
    )
    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        sampler=train_sampler,
        collate_fn=collate_fn,
        num_workers=0,
    )
    val_loader   = DataLoader(val_ds,   batch_size=args.batch_size, shuffle=False, collate_fn=collate_fn, num_workers=0)

    device = select_device()
    print(f"Device: {device} | Train: {train_size} | Val: {val_size}")

    model = PhonSSM().to(device)
    if args.resume_from:
        if not os.path.isfile(args.resume_from):
            raise FileNotFoundError(f"Resume checkpoint not found: {args.resume_from}")
        model.load_state_dict(torch.load(args.resume_from, map_location=device))
        print(f"Resumed model weights from: {args.resume_from}")

    # CTC Loss for continuous sequence modeling.
    # Blanks are set to the maximum class index (63 for handshape, 31 for loc/mov).
    h_criterion  = nn.CTCLoss(blank=63, zero_infinity=True)
    lm_criterion = nn.CTCLoss(blank=31, zero_infinity=True)
    auxiliary_criteria = (
        nn.CrossEntropyLoss(weight=compute_class_weights(train_ds, 63, "handshape").to(device)),
        nn.CrossEntropyLoss(weight=compute_class_weights(train_ds, 31, "location").to(device)),
        nn.CrossEntropyLoss(weight=compute_class_weights(train_ds, 31, "movement").to(device)),
    )

    optimizer = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    # CosineAnnealing gives a warm-then-cool LR schedule; better than ReduceOnPlateau
    # for datasets this size
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=1e-5)

    best_val_loss = args.best_val_loss
    best_h_acc    = 0.0
    best_path     = os.path.join(args.checkpoint_dir, "best_model.pt")

    print(
        f"\nStarting training — {args.epochs} epochs "
        f"(completed previously: {args.start_epoch})\n{'-'*70}"
    )
    for epoch in range(1, args.epochs + 1):
        tr_loss, tr_h, tr_l, tr_m = run_epoch(
            model,
            train_loader,
            h_criterion,
            lm_criterion,
            device,
            optimizer,
            auxiliary_criteria,
            args.aux_weight,
        )
        vl_loss, vl_h, vl_l, vl_m = run_epoch(
            model,
            val_loader,
            h_criterion,
            lm_criterion,
            device,
            auxiliary_criteria=auxiliary_criteria,
            auxiliary_weight=args.aux_weight,
        )

        scheduler.step()

        flag = ""
        # Save best by val_loss; also track best handshape acc separately
        if vl_loss < best_val_loss:
            best_val_loss = vl_loss
            best_h_acc    = vl_h
            torch.save(model.state_dict(), best_path)
            flag = " ← best"
        elif vl_h > best_h_acc:
            best_h_acc = vl_h

        # Show train vs val handshape accuracy to diagnose under/overfitting.
        print(
            f"Epoch {args.start_epoch + epoch:3d}/{args.start_epoch + args.epochs}  "
            f"tr_loss={tr_loss:.4f} vl_loss={vl_loss:.4f}  "
            f"h(tr/vl):{tr_h:.1%}/{vl_h:.1%}  "
            f"l(tr/vl):{tr_l:.1%}/{vl_l:.1%}  "
            f"m(tr/vl):{tr_m:.1%}/{vl_m:.1%}{flag}"
        )

    print(f"\nBest checkpoint saved → {best_path}  (val_loss={best_val_loss:.4f}, best_h_acc={best_h_acc:.2%})")


if __name__ == "__main__":
    main()
