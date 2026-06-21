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
Refer to [DEVELOPMENT_COMMANDS.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/DEVELOPMENT_COMMANDS.md) for execution details.
