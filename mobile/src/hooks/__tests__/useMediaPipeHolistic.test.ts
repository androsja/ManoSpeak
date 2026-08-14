const mockPluginCall = jest.fn();
const mockNormalizeFrame = jest.fn();
const mockSetHandsDetected = jest.fn();

jest.mock('../../services/LandmarkNormalizer', () => ({
  LandmarkNormalizer: {
    normalizeFrame: mockNormalizeFrame,
  },
}));

jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: jest.fn().mockReturnValue({
    hasPermission: true,
    requestPermission: jest.fn().mockResolvedValue(true),
  }),
  useFrameProcessor: jest.fn().mockImplementation((processor) => processor),
  runAtTargetFps: jest.fn().mockImplementation((_fps, processor) => processor()),
  VisionCameraProxy: {
    initFrameProcessorPlugin: jest.fn().mockReturnValue({ call: mockPluginCall }),
  },
}));

jest.mock('react-native-worklets-core', () => ({
  useRunOnJS: jest.fn().mockImplementation((callback) => callback),
}));

jest.mock('react', () => ({
  useRef: jest.fn(),
  useState: jest.fn().mockImplementation((initialValue) => [initialValue, mockSetHandsDetected]),
  useCallback: jest.fn().mockImplementation((callback) => callback),
}));

import { useCameraPermission, runAtTargetFps } from 'react-native-vision-camera';
import { useRef } from 'react';
import { useMediaPipeHolistic } from '../useMediaPipeHolistic';

describe('useMediaPipeHolistic', () => {
  let mockFrameBuffer: {
    addFrame: jest.Mock;
    clear: jest.Mock;
    size: jest.Mock;
    isFull: jest.Mock;
  };
  let mockRawFrameBuffer: {
    addFrame: jest.Mock;
    clear: jest.Mock;
    size: jest.Mock;
    isFull: jest.Mock;
  };
  let rawCoords: number[][];

  beforeEach(() => {
    jest.clearAllMocks();
    rawCoords = Array.from({ length: 543 }, () => [0.1, 0.2, 0.3]);
    mockPluginCall.mockReturnValue(rawCoords);
    mockNormalizeFrame.mockImplementation((frame: number[][]) => frame);

    mockFrameBuffer = {
      addFrame: jest.fn(),
      clear: jest.fn(),
      size: jest.fn().mockReturnValue(0),
      isFull: jest.fn().mockReturnValue(false),
    };
    mockRawFrameBuffer = {
      addFrame: jest.fn(),
      clear: jest.fn(),
      size: jest.fn().mockReturnValue(0),
      isFull: jest.fn().mockReturnValue(false),
    };

    (useRef as jest.Mock)
      .mockReturnValueOnce({ current: mockFrameBuffer })
      .mockReturnValueOnce({ current: mockRawFrameBuffer })
      .mockReturnValueOnce({ current: [] }) // fpsWindowRef
      .mockReturnValueOnce({ current: 0 }) // lastFpsUpdateRef
      .mockReturnValueOnce({ current: false })
      .mockReturnValueOnce({ current: 0 })
      .mockReturnValueOnce({ current: false })
      .mockReturnValueOnce({ current: false })
      .mockReturnValueOnce({ current: [] })
      .mockReturnValueOnce({ current: [] })
      .mockReturnValueOnce({ current: [] })
      .mockReturnValueOnce({ current: [] })
      .mockReturnValueOnce({ current: null });
  });

  test('returns camera permission and the frame buffer', () => {
    const result = useMediaPipeHolistic(30);

    expect(result.hasPermission).toBe(true);
    expect(result.handsDetected).toBe(false);
    expect(result.frameCount).toBe(0);
    expect(result.waitingForRelease).toBe(false);
    expect(result.captureEnabled).toBe(false);
    expect(result.captureComplete).toBe(false);
    expect(result.captureEndReason).toBeNull();
    expect(result.processorTargetFps).toBe(24);
    expect(result.timestampClock).toBe('monotonic_performance_ms');
    expect(result.frameBuffer).toBe(mockFrameBuffer);
    expect(result.rawFrameBuffer).toBe(mockRawFrameBuffer);
  });

  test('requests camera permission', async () => {
    const result = useMediaPipeHolistic(30);
    const requestPermission = (useCameraPermission as jest.Mock)().requestPermission;

    await expect(result.requestPermission()).resolves.toBe(true);
    expect(requestPermission).toHaveBeenCalled();
  });

  test('normalizes and buffers a frame when a hand is detected', () => {
    const result = useMediaPipeHolistic(30);
    const frame = { id: 1 } as any;

    result.startCapture();
    (result.frameProcessor as unknown as (frame: unknown) => void)(frame);

    expect(runAtTargetFps).toHaveBeenCalledWith(24, expect.any(Function));
    expect(mockPluginCall).toHaveBeenCalledWith(frame);
    expect(mockNormalizeFrame).toHaveBeenCalledWith(rawCoords);
    expect(mockFrameBuffer.addFrame).toHaveBeenCalledWith(rawCoords);
    expect(mockRawFrameBuffer.addFrame).toHaveBeenCalledWith(rawCoords);
    expect(mockSetHandsDetected).toHaveBeenCalledWith(true);
    expect(result.captureTimestamps).toHaveLength(1);
    expect(Number.isFinite(result.captureTimestamps[0])).toBe(true);
  });

  test('ignores an invalid landmark array', () => {
    mockPluginCall.mockReturnValue([[0.1, 0.2, 0.3]]);
    const result = useMediaPipeHolistic(30);

    (result.frameProcessor as unknown as (frame: unknown) => void)({ id: 1 });

    expect(mockNormalizeFrame).not.toHaveBeenCalled();
    expect(mockFrameBuffer.addFrame).not.toHaveBeenCalled();
  });

  test('keeps empty frames as pre-roll without adding them before a hand appears', () => {
    rawCoords = Array.from({ length: 543 }, () => [0, 0, 0]);
    mockPluginCall.mockReturnValue(rawCoords);
    const result = useMediaPipeHolistic(30);
    const processFrame = result.frameProcessor as unknown as (frame: unknown) => void;

    result.startCapture();
    processFrame({ id: 1 });
    processFrame({ id: 2 });
    processFrame({ id: 3 });

    expect(mockFrameBuffer.clear).toHaveBeenCalledTimes(1);
    expect(mockNormalizeFrame).toHaveBeenCalledTimes(3);
    expect(mockFrameBuffer.addFrame).not.toHaveBeenCalled();
  });

  test('flushes pre-roll frames when the first hand appears', () => {
    const emptyCoords = Array.from({ length: 543 }, () => [0, 0, 0]);
    mockPluginCall.mockReturnValueOnce(emptyCoords).mockReturnValueOnce(rawCoords);
    const result = useMediaPipeHolistic(30);
    const processFrame = result.frameProcessor as unknown as (frame: unknown) => void;

    result.startCapture();
    processFrame({ id: 1 });
    processFrame({ id: 2 });

    expect(mockRawFrameBuffer.addFrame).toHaveBeenNthCalledWith(1, emptyCoords);
    expect(mockRawFrameBuffer.addFrame).toHaveBeenNthCalledWith(2, rawCoords);
    expect(result.captureTimestamps).toHaveLength(2);
  });

  test('resets a completed capture and waits for hand release', () => {
    const result = useMediaPipeHolistic(30);

    result.resetCapture(true);

    expect(mockFrameBuffer.clear).toHaveBeenCalledTimes(1);
    expect(mockSetHandsDetected).toHaveBeenCalledWith(0);
    expect(mockSetHandsDetected).toHaveBeenCalledWith(true);
  });

  test('does not process frames until capture is explicitly started', () => {
    const result = useMediaPipeHolistic(30);

    (result.frameProcessor as unknown as (frame: unknown) => void)({ id: 1 });

    expect(mockNormalizeFrame).not.toHaveBeenCalled();
    expect(mockFrameBuffer.addFrame).not.toHaveBeenCalled();
  });
});
