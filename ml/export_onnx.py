import torch
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))
from model import PhonSSM

model = PhonSSM()
model.load_state_dict(torch.load("checkpoints/best_model.pt", map_location='cpu'))
model.eval()

dummy_input = torch.randn(1, 10, 543, 3)
torch.onnx.export(
    model, dummy_input, "../mobile/assets/models/phonssm.onnx",
    input_names=['landmarks'],
    output_names=['handshape', 'location', 'movement']
)
print("Real AI model (ONNX) exported successfully directly to the mobile app!")
