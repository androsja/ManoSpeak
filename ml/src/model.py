import torch
import torch.nn as nn
import torch.nn.functional as F

# ManoSpeak stores MediaPipe Holistic landmarks as pose, left hand, right hand,
# then face. Both preprocessing implementations use this exact 543-point order.
_HAND_START = 33
_HAND_END = 75  # exclusive: 42 landmarks x 3 coordinates = 126 features


class AnatomicalGraphAttention(nn.Module):
    """
    Anatomical Graph Attention Network (AGAN) layer.
    Computes self-attention over coordinates to focus on joint relations.
    """
    def __init__(self, in_features: int, out_features: int, num_heads: int = 4) -> None:
        super().__init__()
        self.num_heads = num_heads
        self.head_dim  = out_features // num_heads

        self.q_proj  = nn.Linear(in_features,  out_features)
        self.k_proj  = nn.Linear(in_features,  out_features)
        self.v_proj  = nn.Linear(in_features,  out_features)
        self.out_proj = nn.Linear(out_features, out_features)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, in_features)
        B, T, _ = x.size()

        q = self.q_proj(x).view(B, T, self.num_heads, self.head_dim).transpose(1, 2)
        k = self.k_proj(x).view(B, T, self.num_heads, self.head_dim).transpose(1, 2)
        v = self.v_proj(x).view(B, T, self.num_heads, self.head_dim).transpose(1, 2)

        scores      = torch.matmul(q, k.transpose(-2, -1)) / (self.head_dim ** 0.5)
        attn_weights = F.softmax(scores, dim=-1)

        context = torch.matmul(attn_weights, v)
        context = context.transpose(1, 2).contiguous().view(B, T, -1)
        return self.out_proj(context)


class HandshapeBranch(nn.Module):
    """
    Dedicated hand-landmark branch for handshape classification.

    Operates on the 42 hand keypoints only (left + right, indices 33-74),
    giving the model a fine-grained, uncluttered view of finger configuration
    that the global trunk cannot provide.

    Architecture:
        Linear(126 → 128) → AGAN(128) → GRU(128, 1-layer) → mean+max pool → Linear(256 → 128)
    """
    HAND_DIM = (_HAND_END - _HAND_START) * 3   # 42 × 3 = 126

    def __init__(self, out_dim: int = 128, dropout: float = 0.3) -> None:
        super().__init__()
        self.proj  = nn.Linear(self.HAND_DIM, out_dim)
        self.agan  = AnatomicalGraphAttention(out_dim, out_dim, num_heads=4)
        self.gru   = nn.GRU(out_dim, out_dim, num_layers=1, batch_first=True, bidirectional=False)
        self.fc    = nn.Linear(out_dim, out_dim)   # direct from GRU, no pooling
        self.drop  = nn.Dropout(dropout)

    def forward(self, x_full: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x_full: (B, T, 543, 3) or (B, T, 1629) — full holistic landmarks.
        Returns:
            hand_feat: (B, out_dim)
        """
        B, T = x_full.shape[:2]
        if x_full.dim() == 4:
            # Slice hand landmarks and flatten: (B, T, 42, 3) → (B, T, 126)
            hand = x_full[:, :, _HAND_START:_HAND_END, :].reshape(B, T, self.HAND_DIM)
        else:
            # Already flattened: (B, T, 1629), hand slice = [99:225]
            hand = x_full[:, :, _HAND_START * 3 : _HAND_END * 3]

        h = F.relu(self.proj(hand))             # (B, T, 128)
        h = self.agan(h) + h                    # residual
        gru_out, _ = self.gru(h)                # (B, T, 128)

        # Removed temporal pooling for sequence-to-sequence output
        return self.drop(F.relu(self.fc(gru_out)))  # (B, T, 128)


class PhonSSM(nn.Module):
    """
    Phonological State Space Model (PhonSSM) — v2.

    Changes vs v1:
    * HandshapeBranch — dedicated hand-landmark pathway for fine-grained
      finger configuration encoding.
    * No temporal pooling — outputs per-frame sequences (B, T, num_classes) for CTC.
    * Dropout(0.3) on every classification head.
    * Backward-compatible ONNX signature: input `landmarks` (B, T, 543, 3),
      outputs `handshape`, `location`, `movement` unchanged.
    """

    def __init__(
        self,
        num_handshapes: int = 64,
        num_locations:  int = 32,
        num_movements:  int = 32,
        dropout:        float = 0.3,
    ) -> None:
        super().__init__()
        self.num_handshapes = num_handshapes
        self.num_locations  = num_locations
        self.num_movements  = num_movements

        # ── Global trunk ─────────────────────────────────────────────────
        self.input_dim  = 543 * 3   # 1629
        self.hidden_dim = 256

        self.input_layer = nn.Linear(self.input_dim, self.hidden_dim)
        self.agan        = AnatomicalGraphAttention(self.hidden_dim, self.hidden_dim)
        self.gru         = nn.GRU(
            self.hidden_dim, self.hidden_dim,
            num_layers=2, batch_first=True, bidirectional=True,
        )
        # bidirectional GRU output is hidden_dim * 2
        self.fc = nn.Linear(self.hidden_dim * 2, self.hidden_dim)

        # ── Dedicated handshape branch ────────────────────────────────────
        self.handshape_branch = HandshapeBranch(out_dim=128, dropout=dropout)

        # ── Classification heads ──────────────────────────────────────────
        # Handshape fuses trunk (256) + branch (128) = 384
        self.handshape_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(self.hidden_dim + 128, num_handshapes),
        )
        self.location_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(self.hidden_dim, num_locations),
        )
        self.movement_head = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(self.hidden_dim, num_movements),
        )

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        """
        Args:
            x: (B, T, 543, 3) or (B, T, 1629)
        Returns:
            dict with keys 'handshape', 'location', 'movement' — logits.
        """
        B = x.size(0)

        # ── Global trunk ──────────────────────────────────────────────────
        x_flat = x.view(B, x.size(1), -1) if x.dim() == 4 else x

        features = F.relu(self.input_layer(x_flat))     # (B, T, 256)
        features = self.agan(features) + features        # residual

        gru_out, _ = self.gru(features)                  # (B, T, 512) — bidirectional

        # Removed temporal pooling to preserve sequence output for CTC
        trunk = F.relu(self.fc(gru_out))                 # (B, T, 256)

        # ── Hand-specific branch ──────────────────────────────────────────
        hand_feat = self.handshape_branch(x)             # (B, T, 128)

        # ── Heads ─────────────────────────────────────────────────────────
        hs_input = torch.cat([trunk, hand_feat], dim=-1) # (B, T, 384)

        return {
            "handshape": self.handshape_head(hs_input),
            "location":  self.location_head(trunk),
            "movement":  self.movement_head(trunk),
        }
