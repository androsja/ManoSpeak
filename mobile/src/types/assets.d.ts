// Metro resolves binary assets (tflite, onnx, etc.) as a numeric asset handle.
declare module '*.tflite' {
  const assetHandle: number;
  export default assetHandle;
}

declare module '*.onnx' {
  const assetHandle: number;
  export default assetHandle;
}
