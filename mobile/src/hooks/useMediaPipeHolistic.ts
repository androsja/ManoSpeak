import { useState, useRef, useCallback } from 'react';
import {
  useCameraPermission,
  useFrameProcessor,
  Camera,
  Frame,
} from 'react-native-vision-camera';
import { NativeModules } from 'react-native';
import { FrameBuffer } from '../services/FrameBuffer';
import { LandmarkNormalizer } from '../services/LandmarkNormalizer';

const { MediaPipeHolisticDetector } = NativeModules;

interface UseMediaPipeHolisticResult {
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  frameProcessor: ReturnType<typeof useFrameProcessor>;
  frameBuffer: FrameBuffer;
}

export const useMediaPipeHolistic = (capacity: number = 30): UseMediaPipeHolisticResult => {
  const { hasPermission, requestPermission } = useCameraPermission();
  const frameBufferRef = useRef<FrameBuffer>(new FrameBuffer(capacity));

  // react-native-vision-camera v4 API: useFrameProcessor (replaces useFrameOutput in v5)
  const frameProcessor = useFrameProcessor((frame: Frame) => {
    'worklet';

    try {
      // In native code, the frame is processed by MediaPipe Holistic.
      // Synchronous worklet call to the native detector wrapper.
      if (MediaPipeHolisticDetector && MediaPipeHolisticDetector.processFrame) {
        // Send frame reference to native processor
        const coordinates = MediaPipeHolisticDetector.processFrame(frame) as number[][];
        if (coordinates && Array.isArray(coordinates) && coordinates.length === 543) {
          // Normalize coordinates before buffering (mirrors ml/src/normalizers.py)
          const normalized = LandmarkNormalizer.normalizeFrame(coordinates);
          frameBufferRef.current.addFrame(normalized);
        }
      }
    } catch (_err) {
      // Silently handle worklet errors to avoid camera crashes
    }
    // Note: v4 does NOT require manual frame.dispose() — handled by the framework
  }, []);

  return {
    hasPermission,
    requestPermission,
    frameProcessor,
    frameBuffer: frameBufferRef.current,
  };
};
