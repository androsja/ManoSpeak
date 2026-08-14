import { useState, useRef, useCallback } from 'react';
import {
  useCameraPermission,
  useFrameProcessor,
  Frame,
  runAtTargetFps,
} from 'react-native-vision-camera';
import { VisionCameraProxy } from 'react-native-vision-camera';
import { useRunOnJS } from 'react-native-worklets-core';
import { FrameBuffer } from '../services/FrameBuffer';
import { LandmarkNormalizer } from '../services/LandmarkNormalizer';

// Initialize the plugin natively using VisionCamera v4 API
const mediaPipePlugin = VisionCameraProxy.initFrameProcessorPlugin('media_pipe_holistic', {});
const HAND_LANDMARK_START = 33;
const HAND_LANDMARK_END = 75;
const MIN_DETECTED_HAND_LANDMARKS = 8;
const MISSING_HAND_FRAME_LIMIT = 3;
const PRE_ROLL_FRAME_COUNT = 6;
const PROCESSOR_FPS = 24;
const MAX_CAPTURE_DURATION_MS = 5000;

interface UseMediaPipeHolisticResult {
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  frameProcessor: ReturnType<typeof useFrameProcessor>;
  frameBuffer: FrameBuffer;
  rawFrameBuffer: FrameBuffer;
  handsDetected: boolean;
  frameCount: number;
  waitingForRelease: boolean;
  liveFps: number;
  captureEnabled: boolean;
  captureComplete: boolean;
  captureEndReason: 'hand_release' | 'max_duration' | null;
  captureTimestamps: number[];
  captureDurationMs: number;
  processorTargetFps: number;
  timestampClock: 'monotonic_performance_ms';
  startCapture: () => void;
  resetCapture: (waitForRelease?: boolean) => void;
}

export const useMediaPipeHolistic = (capacity: number = 144): UseMediaPipeHolisticResult => {
  const { hasPermission, requestPermission } = useCameraPermission();
  const frameBufferRef = useRef<FrameBuffer>(new FrameBuffer(capacity));
  const rawFrameBufferRef = useRef<FrameBuffer>(new FrameBuffer(capacity));
  const [handsDetected, setHandsDetected] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [waitingForRelease, setWaitingForRelease] = useState(false);
  const [liveFps, setLiveFps] = useState(0);
  const fpsWindowRef = useRef<number[]>([]);
  const lastFpsUpdateRef = useRef(0);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [captureComplete, setCaptureComplete] = useState(false);
  const [captureEndReason, setCaptureEndReason] = useState<'hand_release' | 'max_duration' | null>(null);
  const [captureDurationMs, setCaptureDurationMs] = useState(0);
  const handsDetectedRef = useRef(false);
  const missingHandFramesRef = useRef(0);
  const waitingForReleaseRef = useRef(false);
  const captureEnabledRef = useRef(false);
  const captureTimestampsRef = useRef<number[]>([]);
  const preRollRawFramesRef = useRef<number[][][]>([]);
  const preRollNormalizedFramesRef = useRef<number[][][]>([]);
  const preRollTimestampsRef = useRef<number[]>([]);
  const firstHandTimestampRef = useRef<number | null>(null);

  const completeCapture = useCallback((reason: 'hand_release' | 'max_duration') => {
    captureEnabledRef.current = false;
    setCaptureEnabled(false);
    setCaptureComplete(true);
    setCaptureEndReason(reason);
    setFrameCount(rawFrameBufferRef.current.size());
    const timestamps = captureTimestampsRef.current;
    setCaptureDurationMs(
      timestamps.length > 1 ? timestamps[timestamps.length - 1] - timestamps[0] : 0,
    );
  }, []);

  const startCapture = useCallback(() => {
    frameBufferRef.current.clear();
    rawFrameBufferRef.current.clear();
    setFrameCount(0);
    setCaptureDurationMs(0);
    captureTimestampsRef.current.length = 0;
    preRollRawFramesRef.current.length = 0;
    preRollNormalizedFramesRef.current.length = 0;
    preRollTimestampsRef.current.length = 0;
    firstHandTimestampRef.current = null;
    missingHandFramesRef.current = 0;
    waitingForReleaseRef.current = false;
    setWaitingForRelease(false);
    captureEnabledRef.current = true;
    setCaptureEnabled(true);
    setCaptureComplete(false);
    setCaptureEndReason(null);
    handsDetectedRef.current = false;
    setHandsDetected(false);
  }, []);

  const resetCapture = useCallback((waitForRelease: boolean = false) => {
    frameBufferRef.current.clear();
    rawFrameBufferRef.current.clear();
    setFrameCount(0);
    setCaptureDurationMs(0);
    captureTimestampsRef.current.length = 0;
    preRollRawFramesRef.current.length = 0;
    preRollNormalizedFramesRef.current.length = 0;
    preRollTimestampsRef.current.length = 0;
    firstHandTimestampRef.current = null;
    captureEnabledRef.current = false;
    setCaptureEnabled(false);
    setCaptureComplete(false);
    setCaptureEndReason(null);
    waitingForReleaseRef.current = waitForRelease;
    setWaitingForRelease(waitForRelease);
  }, []);

  // Safely define the function that must run on the JS thread
  const addFrameSafely = useRunOnJS((coords: number[][]) => {
    try {
      // Live channel-health metric: effective processed-frame rate over a
      // rolling 2s window, updated ~2x/sec, independent of capture state.
      const arrivalTime = performance.now();
      const fpsWindow = fpsWindowRef.current;
      fpsWindow.push(arrivalTime);
      while (fpsWindow.length > 0 && arrivalTime - fpsWindow[0] > 2000) fpsWindow.shift();
      if (arrivalTime - lastFpsUpdateRef.current > 500) {
        lastFpsUpdateRef.current = arrivalTime;
        setLiveFps(
          fpsWindow.length > 1
            ? ((fpsWindow.length - 1) * 1000) / (arrivalTime - fpsWindow[0])
            : 0,
        );
      }

      const detectedHandLandmarks = coords
        .slice(HAND_LANDMARK_START, HAND_LANDMARK_END)
        .filter(([x, y, z]) => x !== 0 || y !== 0 || z !== 0).length;

      const handDetected = detectedHandLandmarks >= MIN_DETECTED_HAND_LANDMARKS;

      if (waitingForReleaseRef.current) {
        if (handDetected) {
          missingHandFramesRef.current = 0;
          if (!handsDetectedRef.current) {
            handsDetectedRef.current = true;
            setHandsDetected(true);
          }
        } else {
          missingHandFramesRef.current += 1;
          if (missingHandFramesRef.current >= MISSING_HAND_FRAME_LIMIT) {
            waitingForReleaseRef.current = false;
            setWaitingForRelease(false);
            handsDetectedRef.current = false;
            setHandsDetected(false);
          }
        }
        return;
      }

      if (!captureEnabledRef.current) return;

      const timestamp = performance.now();
      const normalized = LandmarkNormalizer.normalizeFrame(coords);

      if (!handsDetectedRef.current && !handDetected) {
        preRollRawFramesRef.current.push(coords);
        preRollNormalizedFramesRef.current.push(normalized);
        preRollTimestampsRef.current.push(timestamp);
        if (preRollRawFramesRef.current.length > PRE_ROLL_FRAME_COUNT) {
          preRollRawFramesRef.current.shift();
          preRollNormalizedFramesRef.current.shift();
          preRollTimestampsRef.current.shift();
        }
        return;
      }

      if (!handsDetectedRef.current && handDetected) {
        preRollRawFramesRef.current.forEach((frame, index) => {
          rawFrameBufferRef.current.addFrame(frame);
          frameBufferRef.current.addFrame(preRollNormalizedFramesRef.current[index]);
          captureTimestampsRef.current.push(preRollTimestampsRef.current[index]);
        });
        preRollRawFramesRef.current.length = 0;
        preRollNormalizedFramesRef.current.length = 0;
        preRollTimestampsRef.current.length = 0;
        firstHandTimestampRef.current = timestamp;
      }

      if (!handDetected) {
        missingHandFramesRef.current += 1;
      } else {
        missingHandFramesRef.current = 0;
        if (!handsDetectedRef.current) {
          handsDetectedRef.current = true;
          setHandsDetected(true);
        }
      }

      captureTimestampsRef.current.push(timestamp);
      rawFrameBufferRef.current.addFrame(coords);
      frameBufferRef.current.addFrame(normalized);
      const nextFrameCount = frameBufferRef.current.size();
      const firstHandTimestamp = firstHandTimestampRef.current ?? timestamp;
      const elapsedMs = timestamp - firstHandTimestamp;
      setFrameCount(nextFrameCount);
      setCaptureDurationMs(elapsedMs);

      if (!handDetected && missingHandFramesRef.current >= MISSING_HAND_FRAME_LIMIT) {
          handsDetectedRef.current = false;
          setHandsDetected(false);
          completeCapture('hand_release');
        return;
      }

      if (elapsedMs >= MAX_CAPTURE_DURATION_MS || frameBufferRef.current.isFull()) {
        completeCapture('max_duration');
      }
    } catch (jsErr) {
      console.log('Error processing frame on JS thread', jsErr);
    }
  }, []);

  // react-native-vision-camera v4 API: useFrameProcessor
  const frameProcessor = useFrameProcessor((frame: Frame) => {
    'worklet';

    try {
      if (mediaPipePlugin) {
        runAtTargetFps(PROCESSOR_FPS, () => {
          const coordinates = mediaPipePlugin.call(frame) as unknown as number[][];

          if (coordinates && Array.isArray(coordinates) && coordinates.length === 543) {
            addFrameSafely(coordinates);
          }
        });
      }
    } catch (_err: any) {
      console.log('Worklet Error: ', _err.message || _err);
    }
  }, [addFrameSafely]);

  return {
    hasPermission,
    requestPermission,
    frameProcessor,
    frameBuffer: frameBufferRef.current,
    rawFrameBuffer: rawFrameBufferRef.current,
    handsDetected,
    frameCount,
    waitingForRelease,
    liveFps,
    captureEnabled,
    captureComplete,
    captureEndReason,
    captureTimestamps: captureTimestampsRef.current,
    captureDurationMs,
    processorTargetFps: PROCESSOR_FPS,
    timestampClock: 'monotonic_performance_ms',
    startCapture,
    resetCapture,
  };
};
