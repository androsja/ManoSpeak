import { useState, useRef, useCallback } from 'react';
import {
  useCameraPermission,
  useFrameProcessor,
  Camera,
  Frame,
} from 'react-native-vision-camera';
import { VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { FrameBuffer } from '../services/FrameBuffer';
import { LandmarkNormalizer } from '../services/LandmarkNormalizer';

// Initialize the plugin natively using VisionCamera v4 API
const mediaPipePlugin = VisionCameraProxy.initFrameProcessorPlugin('media_pipe_holistic', {});

interface UseMediaPipeHolisticResult {
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  frameProcessor: ReturnType<typeof useFrameProcessor>;
  frameBuffer: FrameBuffer;
}

export const useMediaPipeHolistic = (capacity: number = 30): UseMediaPipeHolisticResult => {
  const { hasPermission, requestPermission } = useCameraPermission();
  const frameBufferRef = useRef<FrameBuffer>(new FrameBuffer(capacity));

  // Safely define the function that must run on the JS thread
  const addFrameSafely = useRunOnJS((coords: number[][]) => {
    try {
      // Normalize coordinates before buffering for the ML model (ALWAYS RUNS)
      const normalized = LandmarkNormalizer.normalizeFrame(coords);
      frameBufferRef.current.addFrame(normalized);
      
      // Removed UI state updates for raw coordinates to maximize performance
    } catch (jsErr) {
      console.log("Error processing frame on JS thread", jsErr);
    }
  }, []);

  // react-native-vision-camera v4 API: useFrameProcessor
  const frameProcessor = useFrameProcessor((frame: Frame) => {
    'worklet';

    try {
      if (mediaPipePlugin) {
        // Send frame reference to native processor synchronously on the worklet thread
        const coordinates = mediaPipePlugin.call(frame) as unknown as number[][];
        
        if (coordinates && Array.isArray(coordinates) && coordinates.length === 543) {
          // Pass the coordinates back to the JS thread to run class methods safely
          addFrameSafely(coordinates);
        }
      }
    } catch (_err: any) {
      console.log("Worklet Error: ", _err.message || _err);
    }
  }, [addFrameSafely]);

  return {
    hasPermission,
    requestPermission,
    frameProcessor,
    frameBuffer: frameBufferRef.current,
  };
};
