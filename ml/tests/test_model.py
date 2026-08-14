import torch

from src.model import HandshapeBranch
from src.train import LSCDataset, compute_gloss_balancing_weights, pool_valid_nonblank_logits


def test_handshape_branch_reads_hand_landmarks_not_face_landmarks() -> None:
    branch = HandshapeBranch(out_dim=8, dropout=0.0).eval()
    landmarks = torch.zeros((1, 2, 543, 3), dtype=torch.float32)
    hand_values = torch.arange(42 * 3, dtype=torch.float32).reshape(42, 3)

    landmarks[:, :, 33:75, :] = hand_values
    landmarks[:, :, 501:543, :] = -999.0

    projected_inputs: list[torch.Tensor] = []
    hook = branch.proj.register_forward_pre_hook(
        lambda _module, args: projected_inputs.append(args[0].detach().clone())
    )
    try:
        with torch.no_grad():
            branch(landmarks)
    finally:
        hook.remove()

    expected = hand_values.reshape(1, 1, 126).expand(1, 2, 126)
    assert len(projected_inputs) == 1
    assert torch.equal(projected_inputs[0], expected)


def test_pool_valid_nonblank_logits_ignores_padding_and_blank() -> None:
    logits = torch.zeros((2, 3, 4), dtype=torch.float32)
    logits[0, 0, 1] = 5.0
    logits[0, 1, 2] = 100.0
    logits[0, 0, 3] = 200.0
    logits[1, 1, 2] = 7.0

    pooled = pool_valid_nonblank_logits(
        logits,
        input_lengths=torch.tensor([1, 2]),
        blank_index=3,
    )

    assert pooled.argmax(dim=1).tolist() == [1, 2]


def test_gloss_balancing_weights_equalize_class_probability(tmp_path) -> None:
    for filename in ["Per1_HOLA.npy", "Per2_HOLA.npy", "Per3_GRACIAS.npy"]:
        (tmp_path / filename).write_bytes(b"fixture")

    dataset = LSCDataset(str(tmp_path), augment=False)
    subset = torch.utils.data.Subset(dataset, [0, 1, 2])
    weights = compute_gloss_balancing_weights(subset)

    weights_by_gloss: dict[str, float] = {}
    for index, weight in zip(subset.indices, weights, strict=True):
        gloss = dataset._extract_gloss(dataset.file_paths[index])
        weights_by_gloss[gloss] = weights_by_gloss.get(gloss, 0.0) + weight

    assert weights_by_gloss == {"GRACIAS": 1.0, "HOLA": 1.0}
