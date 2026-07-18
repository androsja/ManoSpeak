import onnx
model = onnx.load("../mobile/assets/models/phonssm_fp32.onnx")
print("Model loaded.")
for inp in model.graph.input:
    print("Input:", inp.name)
for out in model.graph.output:
    print("Output:", out.name)
