# Security and Privacy Policy — ManoSpeak

## 1. The Local-First Privacy Boundary
ManoSpeak is built on a **privacy-by-design** architecture. Because sign language translators capture video containing faces and private living environments, sending raw video data or skeletal coordinates to a third-party server represents a major privacy risk.

### Security Guarantees
- **No Cloud Uploads:** The application does not upload video feeds, extracted coordinate landmarks, or translation outputs to external cloud endpoints.
- **Volatile Frame Analysis:** Video frames read from the device camera are loaded directly into volatile RAM, analyzed in memory for landmarks by MediaPipe Holistic, and discarded immediately. No video frames are written to flash storage.
- **Offline Self-Sufficiency:** The app must run fully offline without any internet connection. Network API calls for translation or speech synthesis are strictly prohibited.

## 2. On-Device Model Security
The TFLite model weights stored in the mobile assets directory (`mobile/assets/models/phonssm_quant.tflite`) are asset-protected.
- **Integrity Validation:** When compiling production builds, the app should compare the local model hash against a hardcoded SHA256 checksum to prevent injection or corruption of model weights.
- **No Ad-Hoc Dynamic Loading:** The model is bundled statically inside the application binary. Over-the-air model updates must be delivered through signed store updates rather than dynamic web downloads.

## 3. Guidelines for AI Agents
When modifying or developing code for ManoSpeak:
- **No Analytics Hooks:** Do not introduce tracking scripts, crash report uploads that include landmark vectors, or network telemetry libraries (e.g., Firebase, Segment) without explicit security reviews.
- **Secrets Management:** Keep credentials out of the repository. Since all synthesis is local, there are no cloud API keys needed for Google Cloud TTS or Amazon Polly. Any local configuration keys must live in `.env` files which are strictly gitignored.
- **Asset Access Permissions:** Ensure camera access permissions requested in `AndroidManifest.xml` and `Info.plist` are limited only to runtime translation needs. Do not ask for photo library writes or general storage tracking unless explicitly required.
