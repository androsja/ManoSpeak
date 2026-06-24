"""
Export trained PhonSSM checkpoint to quantized ONNX for onnxruntime-react-native.

Pipeline: PyTorch .pt → ONNX fp32 → ONNX INT8 (dynamic quantization)
Output:   mobile/assets/models/phonssm.onnx
"""

import os
import argparse
import numpy as np
import torch
from model import PhonSSM


def export(model_path: str, output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print(f"Loading checkpoint: {model_path}")
    model = PhonSSM()
    if os.path.exists(model_path):
        model.load_state_dict(torch.load(model_path, map_location="cpu"))
        print("Weights loaded.")
    else:
        print("WARNING: checkpoint not found, exporting with random weights.")
    model.eval()

    # Export to ONNX fp32
    # Input: (batch=1, frames=30, 543 landmarks, 3 coords)
    dummy = torch.randn(1, 30, 543, 3)
    onnx_fp32_path = output_path.replace(".onnx", "_fp32.onnx")

    print("1/3 Exporting PyTorch → ONNX fp32...")
    torch.onnx.export(
        model,
        dummy,
        onnx_fp32_path,
        input_names=["landmarks"],
        output_names=["handshape", "location", "movement"],
        dynamic_axes={
            "landmarks": {1: "frames"},
            "handshape": {1: "frames"},
            "location":  {1: "frames"},
            "movement":  {1: "frames"},
        },
        opset_version=17,
        dynamo=False,
    )
    print(f"    Saved: {onnx_fp32_path} ({os.path.getsize(onnx_fp32_path)/1e6:.2f} MB)")

    # Validate
    import onnx
    model_onnx = onnx.load(onnx_fp32_path)
    onnx.checker.check_model(model_onnx)
    print("    ONNX model validated OK.")

    # Quantize to INT8 (dynamic — no calibration dataset needed)
    print("2/3 Quantizing to INT8...")
    from onnxruntime.quantization import quantize_dynamic, QuantType
    quantize_dynamic(
        onnx_fp32_path,
        output_path,
        weight_type=QuantType.QInt8,
    )
    size_mb = os.path.getsize(output_path) / 1e6
    print(f"    Saved: {output_path} ({size_mb:.2f} MB)")

    # Quick inference check
    print("3/3 Running inference check...")
    import onnxruntime as ort
    sess = ort.InferenceSession(output_path, providers=["CPUExecutionProvider"])
    test_input = np.random.randn(1, 30, 543, 3).astype(np.float32)
    outputs = sess.run(None, {"landmarks": test_input})
    print(f"    handshape logits shape: {outputs[0].shape}")
    print(f"    location  logits shape: {outputs[1].shape}")
    print(f"    movement  logits shape: {outputs[2].shape}")
    print("    Inference check passed.")

    print(f"\nExport complete: {output_path}")
    print(f"Final model size: {size_mb:.2f} MB (target: <15 MB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_path", default="checkpoints/best_model.pt")
    parser.add_argument("--output_path", default="../mobile/assets/models/phonssm.onnx")
    args = parser.parse_args()
    export(args.model_path, args.output_path)


if __name__ == "__main__":
    main()
