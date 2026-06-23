# Skills and Agents Catalog — ManoSpeak

This catalog records all configured agent personas and DWP-related skills available in this repository.

## Active Personas
- [architect.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/.agents/agents/architect.md): Oversees design structures and performance budgets.
- [ml-researcher.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/.agents/agents/ml-researcher.md): Coordinate normalizers and training pipelines.
- [mobile-developer.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/.agents/agents/mobile-developer.md): UI creation, Camera interfaces, and Local TTS.
- [qa-engineer.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/.agents/agents/qa-engineer.md): Performance profiling and mock tests assertion.

## Installed Skills
- **deepworkplan:** The core Deep Work Plan planning engine (routes to create, execute, refine, resume, status, and verify).

## Reusable Patterns Identified in PLAN_manospeak_model_inference_integration

The following patterns emerged during this plan's execution and are candidates for future skill codification:

### TFLite Mobile Integration Pattern
**Trigger:** Any React Native module adding on-device ML model inference via `react-native-fast-tflite`.  
**Steps:**
1. Add `react-native-fast-tflite` to `package.json`.
2. Configure `metro.config.js` to add `tflite` to `assetExts`.
3. Add `src/types/assets.d.ts` with `*.tflite` module declaration.
4. Configure `jest.config.js` `moduleNameMapper` for `.tflite`/`.onnx` binary stubs.
5. Update iOS `Podfile` `post_install` to enforce `IPHONEOS_DEPLOYMENT_TARGET >= 15.1`.
6. Update Android `build.gradle` with `abiFilters` and `packagingOptions` for `.so` conflicts.
7. Call `loadTensorflowModel(require('./model.tflite'), [])` (CPU-only delegates).
8. Mock `react-native-fast-tflite` in tests via `jest.mock` with `ArrayBuffer` output factories.

### TFLite Inference Decoder Pattern
**Trigger:** Any service that decodes TFLite output tensors (argmax over Float32Array) into a string lookup.  
**Steps:**
1. Receive `ArrayBuffer[]` from `tfliteModel.run([inputBuffer])`.
2. Apply `argmax(new Float32Array(outputs[i]))` for each output head.
3. Compose a key string (e.g., `"${h},${l},${m}"`).
4. Look up in a JSON dictionary asset (`lsc_dictionary.json`) with an in-memory overlay for dynamic overrides.
5. Return a fallback format string if key is absent.

### Jest ArrayBuffer Mock Factory Pattern
**Trigger:** Any test that needs to mock TFLite or other native binary-output model inference.  
**Code:** See `mobile/src/services/__tests__/TranslationAndTts.test.ts` — `makeOutputBuffer(argmaxIdx, size)` and `makeMockTfliteModel(h, l, m)`.

### Binary Asset Jest Stub Pattern
**Trigger:** Any Jest test suite in a React Native project that imports `.tflite`, `.onnx`, or other binary assets via `require`.  
**Steps:**
1. Create `src/__mocks__/fileMock.js` with `module.exports = 1;`.
2. Add `moduleNameMapper: { '\\.tflite$': '<rootDir>/src/__mocks__/fileMock.js' }` to `jest.config.js`.

## Reusable Patterns Identified in PLAN_manospeak_mobile_coordinate_normalization

### Python-to-TypeScript Numeric Normalizer Pattern
**Trigger:** Porting a NumPy-based per-frame normalizer to TypeScript for React Native on-device use.  
**Steps:**
1. Identify the Python sentinel for "undetected" values (e.g., `np.allclose(x, 0.0)`) and mirror as a strict JS check (`=== 0.0`) for truly padded zeros.
2. Port all NumPy math as explicit loops (no spread `Math.min(...arr)` for safety on all JS engines); use accumulated min/max in a single pass for efficiency.
3. Mirror the Python fallback chain exactly: primary anchor → fallback centroid/bbox → all-zero guard.
4. Add a `scale_factor < EPSILON → 1.0` guard before division.
5. Apply normalization and clip only to non-zero (detected) landmarks; zero landmarks must remain exactly `[0, 0, 0]`.
6. Return a new array — never mutate the input.
7. Write parity tests referencing manually-computed Python values to 6 decimal places.

### Worklet-Safe Pure Service Pattern
**Trigger:** Injecting a TypeScript service method into a React Native VisionCamera worklet pipeline (between native detector output and a stateful buffer).  
**Steps:**
1. Keep the service method as a pure static function (no closures, no async, no native calls) so it is safe to invoke from a worklet context.
2. Call the service method between the native detector result and the buffer call, inside the `onFrame` worklet.
3. In tests, mock the service with a jest.mock identity stub — decouples hook tests from the service's math.
4. Add a dedicated integration test that uses real service + real buffer to verify the output flows through to `getFlatArray()` at the correct byte offsets.

### Normalizer Integration Test Pattern (raw → normalize → buffer → flat array)
**Trigger:** Any service that transforms landmark data before it enters a FrameBuffer destined for TFLite inference.  
**Steps:**
1. Compute a `flatIdx(padFrames, frameIdx, landmarkIdx, coordIdx)` helper that accounts for leading zero-padding in FrameBuffer.
2. Verify that expected normalized values appear at exact flat offsets — catches off-by-one bugs in both the normalizer and the buffer layout.
3. Test the sliding-window discard: add `capacity+1` frames and assert that the oldest frame's landmarks are gone from the flat array.
4. Assert `flat.byteLength === capacity × 543 × 3 × 4` (Float32Array element size) to lock TFLite input shape.
