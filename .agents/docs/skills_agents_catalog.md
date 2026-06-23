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
