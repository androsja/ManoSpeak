# Performance Budgets: ManoSpeak

## 1. Measurement Rules

Performance is measured on a physical device with a release build. Desktop ONNX timing,
Metro debug timing, and camera startup are not substitutes for on-device streaming
measurements.

Model inference latency and linguistic commit latency are separate:

- Inference latency covers one model chunk/window execution.
- Commit latency is measured from annotated linguistic endpoint to stable committed
  output and includes decoder lookahead/stability delay.

## 2. Pilot Budgets

| Metric | Target | Failure threshold | Validation |
| --- | ---: | ---: | --- |
| Effective landmark rate | >=24 FPS | <18 FPS sustained | Timestamped accepted frames |
| Dropped-frame rate | <=5% | >10% sustained | Camera/inference counters |
| Recognition model footprint | <=15 MB | >20 MB | Packaged model bytes |
| Chunk inference p95 | <=100 ms | >150 ms | On-device monotonic timers |
| Commit latency median | <=500 ms | >500 ms | Annotated continuous replay/device test |
| Commit latency p95 | <=900 ms | >900 ms | Annotated continuous replay/device test |
| Peak app memory | <=150 MB | >200 MB | Android/iOS profiler |
| False commits in neutral stream | <0.5/minute | >=0.5/minute | At least 20 labeled minutes |
| Thermal behavior | No severe throttling | Severe/repeated throttling | 10-minute continuous run |

Targets are acceptance hypotheses until measured by Task 16. Unmeasured values are
reported as unknown, never as passes.

## 3. Runtime Controls

- Use a bounded rolling landmark buffer; buffer capacity cannot define sign duration.
- Apply backpressure or controlled frame sampling when inference cannot keep pace.
- Preserve original timestamps so dropping frames does not distort measured duration.
- Do not discard landmark groups or change input shape without retraining/export parity.
- TTS executes only for committed events and must not block camera/inference processing.
- Release recognition must operate without Metro or a development server.

## 4. Model Selection

The selected model must satisfy recognition and performance gates together. A larger
model is rejected if latency/thermal limits fail; a faster model is rejected if signer,
sequence, rejection, or domain accuracy gates fail.
