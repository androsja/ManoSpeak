# Interface and Design System — ManoSpeak

## 1. Visual Interface Architecture
Sign translation apps require a clear camera viewing space so that signers can monitor their own posture and ensure their hands stay within MediaPipe's tracking bounding boxes.

### UI Guidelines
- **Camera Viewport:** A central, unobstructed preview area. A subtle, low-opacity guide skeleton is overlaid on the user to provide visual feedback that landmarks are tracking successfully.
- **Translation Overlay:** Displays translated Spanish words at the bottom of the screen with a high contrast background (e.g., pure white text on semi-transparent dark gray `#121212` backgrounds).
- **Aesthetic System:** Sleek, modern dark mode. We avoid busy background patterns or neon decorations that might cause visual fatigue or interfere with hand tracking recognition.

## 2. Text-to-Speech (TTS) Synthesis System
To represent the signer with natural sounding spoken voices, the app implements fine-grained modulation parameters:

### Speech Controls
- **Dialect Selectors:** In Colombia, LSC features dialectal variations between departments. The app supports regional Colombian Spanish accents (Andean, Caribbean, Paisa) to match the user's origin.
- **Speech Rate Speed:** Configurable between $0.75x$ and $1.5x$ speed, allowing users to match the translation timing to their natural signing speed.
- **Pitch and Tone Modulation:** Custom sliders to alter voice pitch (low, medium, high), matching the signer's identity and gender preferences.

## 3. Audio Execution Architecture
- **Pre-Synthesis Loading:** ONNX voice models are pre-loaded in memory during application startup to eliminate first-sentence delay (first-sentence synthesis latency must stay below 80ms).
- **Buffer Queues:** Spoken audio fragments are synthesized and queued sequentially. If a translation is updated dynamically via sliding window refinements, the engine cancels outdated phrases instantly to prevent acoustic overlapping.
