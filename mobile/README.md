# Mobile Module — ManoSpeak

This module contains the React Native code for the on-device user interface, live camera acquisition, frame buffering, and offline speech synthesis (TTS).

## Folder Contents
```text
mobile/
├── assets/
│   └── models/       # Compiled INT8 phonssm_quant.tflite model
├── src/
│   ├── components/   # Camera viewfinders and text overlay components
│   ├── hooks/        # UseFrameProcessor and coordinate buffers hooks
│   ├── services/     # TFLite inference and ONNX local speech synthesis bridges
│   └── App.tsx       # Root React Native application entry point
├── package.json      # Dependencies and execution scripts
└── tsconfig.json     # TypeScript settings
```

## Getting Started
Run:
```bash
npm install
npm run lint
npm test
```

## Published Sign Assets

VOZUAL keeps the editable source motions as JSON files in `assets/motions`.
Android does not package those verbose files. Run the avatar build before an
Android build:

```bash
npm run build:avatar-runtime
```

The build compiles every published motion into a versioned `.motion.bin` file
under `android/app/src/main/assets/avatar/motions`. Each coordinate is stored as
a signed 16-bit integer at a scale of 10,000, preserving all body, hand, and face
landmarks with a maximum quantization error of 0.00005 coordinate units. The
React Native PiP renderer and the full WebView renderer decode the same compact
format, while VOZUAL continues to edit the lossless JSON source.

Refer to [DEVELOPMENT_COMMANDS.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/DEVELOPMENT_COMMANDS.md) for execution details.
