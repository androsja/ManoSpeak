# Performance Benchmarks — ManoSpeak

## 1. Budget and Constraints

| Metric | Target | Hard Constraint | Validation method |
| :--- | :--- | :--- | :--- |
| Landmark Extraction | $\ge 30$ FPS | $24$ FPS | Frame delta metrics |
| Model Weight Footprint | $\le 10$ MB | $15$ MB | APK / IPA bundle size checks |
| Model Inference | $\le 20$ ms | $50$ ms | TFLite benchmark tool |
| Text-to-Speech Latency | $\le 80$ ms | $100$ ms | Synthesizer callback timers |
| Memory (RAM) Usage | $\le 100$ MB | $150$ MB | Xcode / Android Profiler |
| Thermal Ceiling | Normal | Low throttling | 10 mins continuous execution |

## 2. Optimizations

### Landmark Downsampling
If the user's mobile processor undergoes thermal throttling:
- MediaPipe Holistic detection can be downsampled dynamically from 30 FPS to 24 FPS by discarding every fifth frame.
- Discard face points that do not represent active linguistic signals (e.g., forehead or outer cheek landmarks), tracking only the mouth, eyes, and eyebrows to reduce coordinate sizes.

### ONNX Runtime execution
ONNX models (`Supertonic`/`Kokoro` TTS) run locally through React Native Executorch.
- Bind calculations to the hardware neural processing units (NPU) or GPU accelerators via Apple's CoreML delegate and Android's NNAPI delegate to reduce CPU load.
- If accelerator delegates are unavailable, fall back immediately to OS-native Speech Synthesis engines which operate inside daemon services, eliminating in-app memory spikes.
