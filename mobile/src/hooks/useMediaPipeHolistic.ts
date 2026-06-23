import { useState, useRef } from 'react';
import { useCameraPermission, useFrameOutput, Frame } from 'react-native-vision-camera';
import { NativeModules } from 'react-native';
import { FrameBuffer } from '../services/FrameBuffer';
import { LandmarkNormalizer } from '../services/LandmarkNormalizer';

const { MediaPipeHolisticDetector } = NativeModules;

interface UseMediaPipeHolisticResult {
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  frameOutput: ReturnType<typeof useFrameOutput>;
  frameBuffer: FrameBuffer;
}

export const useMediaPipeHolistic = (capacity: number = 30): UseMediaPipeHolisticResult => {
  const { hasPermission, requestPermission } = useCameraPermission();
  const frameBufferRef = useRef<FrameBuffer>(new FrameBuffer(capacity));

  // Frame processor output in react-native-vision-camera v5
  const frameOutput = useFrameOutput({
    pixelFormat: 'rgb', // TFLite models typically expect RGB format
    onFrame(frame: Frame) {
      'worklet';

      try {
        // In native code, the frame is processed by MediaPipe Holistic.
        // For worklets, synchronous calls to native methods can be registered.
        // Here we call the detector wrapper.
        if (MediaPipeHolisticDetector && MediaPipeHolisticDetector.processFrame) {
          // Send frame address/reference to native processor
          const coordinates = MediaPipeHolisticDetector.processFrame(frame) as number[][];
          if (coordinates && Array.isArray(coordinates) && coordinates.length === 543) {
            // Normalize coordinates before buffering (mirrors ml/src/normalizers.py)
            const normalized = LandmarkNormalizer.normalizeFrame(coordinates);
            frameBufferRef.current.addFrame(normalized);
          }
        }
      } catch (err) {
        // Silently handle worklet execution errors to avoid crashes
      } finally {
        // CRITICAL in react-native-vision-camera v5: Always dispose of the frame when done!
        frame.dispose();
      }
    }
  });

  return {
    hasPermission,
    requestPermission,
    frameOutput,
    frameBuffer: frameBufferRef.current,
  };
};
