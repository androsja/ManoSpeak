# Engineering Standards — ManoSpeak

## 1. Landmark Coordinate Normalization
Raw landmark coordinates from MediaPipe Holistic contain environmental noise such as camera distance, tilt, and user height. The pipeline must apply strict translational and scale normalization.

### Translational Invariance
All extracted landmarks $x_i$ must be converted from absolute screen space coordinates to body-centric relative coordinate vectors:
$$x'_i = x_i - x_{\text{ref}}$$
- **Reference Anchor ($x_{\text{ref}}$):** The center point of the torso (midpoint between left and right shoulders) or the base of the wrist for isolated hand gestures.
- This ensures that if the user moves within the camera frame or tilts the camera, the structural topology of the joints remains constant.

### Scale Invariance
To eliminate variations in user body sizes (e.g., adult vs. child) and distance from the lens, normalize the coordinate magnitudes:
$$x'' _i = \frac{x'_i}{D_{\text{scale}}}$$
- **Scale Factor ($D_{\text{scale}}$):** The clavicular distance (distance between the left and right shoulder landmarks) or the length of the middle finger bone for hand-only models.
- All final coordinate values are scaled strictly into the range $[-1.0, 1.0]$.

## 2. Post-Training Quantization (PTQ)
To run models on mid-to-low-tier mobile CPUs without causing thermal throttling or high memory overhead:
- All training is done in 32-bit Floating Point (FP32).
- **PTQ:** Export models through TensorFlow Lite (TFLite) using full integer quantization (`INT8`).
- **Memory Constraint:** The exported `.tflite` model size must not exceed **15 MB**.
- **Accuracy Drop:** PTQ optimization must be verified to keep the accuracy loss under $1.5\%$ compared to the FP32 source.

## 3. Synthetic Data & Sim2Real Bridging
To train models on vocabularies that lack large video datasets:
- **Input Pipeline:** Parse Hamburg Notation System (**HamNoSys**) symbols into **SiGML** XML files, which render biomechanical animations procedimentally.
- **Visual Bypass:** Never feed rendered RGB images from 3D avatares into the machine learning classifiers. Instead, extract coordinates from the avatar's joint skeletons directly.
- **Sim2Real Augmentation:** To close the domain gap (perfect movements of virtual avatares vs. noisy human movement), the training loader must inject:
  - **Gauss Jitter:** Small position variations ($\sigma = 0.02$) on coordinates.
  - **Time Warping:** Dynamically speed up or slow down gesture frames by $\pm 15\%$.
  - **Micro-scaling:** Asymmetric scale shifts to mimic joint flexibility.
  - **GAN Refinement:** Pass generated skeletal tracks through a Trained Pose Generative Adversarial Network (e.g., HP-GAN) to synthesize physiological noise.
