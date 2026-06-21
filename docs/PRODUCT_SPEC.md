# Product Specification — ManoSpeak

## 1. Product Vision & Problem Statement
ManoSpeak is a high-performance, edge-based mobile translation application designed to translate Colombian Sign Language (LSC - Lengua de Señas Colombiana) to spoken audio in real-time. 

Traditional sign-to-speech translators often treat signs as static images or raw video frames (RGB), ignoring linguistic grammar. They typically require cloud-based APIs to perform heavy video inference, introducing high network latencies, API costs, and severe privacy violations (uploading video streams of users' private environments).

ManoSpeak overcomes these boundaries by performing **on-device, geometry-based real-time translation**. Instead of reading raw pixel grids, it extracts skeletal coordinates (landmarks) directly from the device camera and translates continuous signing into natural spoken sentences.

## 2. Linguistic Foundation: The Parametric Nature of Sign Language
Unlike spoken languages built on sequential phonemes, sign languages are independent, three-dimensional languages that convey meaning through spatial configuration and temporal movement. 

Following William Stokoe's linguistic model, every sign in LSC can be factored into simultaneously executed parameters:
- **Handshape (Configuración de la mano):** The physical layout of the fingers and palms.
- **Location (Ubicación):** The position of the hands relative to the signer's body/face.
- **Movement (Movimiento):** The spatial trajectory, speed, and path taken by the hands.

Refined by the **Move-Hold (Movimiento-Detención)** model of Liddell and Johnson, LSC consists of segments where articulation is changing (Move) and segments where postures remain fixed (Hold). 

Additionally, **non-manual markers** (facial expression, head posture, torso tilt, and gaze direction) act as syntactic inflections. In LSC, these elements are critical; they distinguish interrogative, conditional, and negative statements.

## 3. Product Goals and Boundaries
### Core Goals
- **Continuous Sign Translation:** Translate fluid, conversational LSC signing without forcing the user to pause between individual words (avoiding the limitations of Isolated Sign Language Recognition - ISLR).
- **LSC Dictionary Alignment:** Support vocabulary scales aligning with national standards, such as the *Diccionario Básico de la Lengua de Señas Colombiana* published by the **Instituto Nacional para Sordos (INSOR)**.
- **On-Device Offline Execution:** All camera frames, landmark extractions, model inferences, and speech syntheses must execute strictly on-device without active internet requirements.
- **Empathetic Speech Output:** Synthesis of spoken audio using natural, expressive voices that adapt to the speaker's regional dialect (LSC50 and LSC-W70 research standards).

### Non-Goals
- **Sign-to-Sign translation:** ManoSpeak focuses strictly on translating LSC to vocalized Spanish. It does not generate sign movements from text.
- **Cloud-based model training on mobile:** In-app learning is metric-based (few-shot prototype registration). Large-scale model training is restricted to high-performance servers.
- **General-purpose video recording:** The camera feed is analyzed in volatile memory for landmark extraction and discarded immediately. No video files are recorded.
