const mockProcessFrame = jest.fn();
jest.mock('react-native', () => ({
  NativeModules: {
    MediaPipeHolisticDetector: {
      processFrame: mockProcessFrame,
    },
  },
}));

// Mock LandmarkNormalizer as identity so hook tests remain decoupled from
// normalizer math (LandmarkNormalizer has its own unit test suite).
const mockNormalizeFrame = jest.fn();
jest.mock('../../services/LandmarkNormalizer', () => ({
  LandmarkNormalizer: {
    normalizeFrame: mockNormalizeFrame,
  },
}));

import { useMediaPipeHolistic } from '../useMediaPipeHolistic';
import { useCameraPermission, useFrameOutput } from 'react-native-vision-camera';
import { useRef } from 'react';
import { LandmarkNormalizer } from '../../services/LandmarkNormalizer';

// Mock react-native-vision-camera hooks
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: jest.fn().mockReturnValue({
    hasPermission: true,
    requestPermission: jest.fn().mockResolvedValue(true),
  }),
  useFrameOutput: jest.fn().mockImplementation((options) => ({
    options,
    triggerFrame: (frame: any) => options.onFrame(frame),
  })),
}));

// Mock React's useRef
jest.mock('react', () => {
  const actualReact = jest.requireActual('react');
  return {
    ...actualReact,
    useRef: jest.fn(),
  };
});

describe('useMediaPipeHolistic Hook Tests', () => {
  let mockFrameBuffer: any;
  let mockFrames: number[][][];
  let rawCoords: number[][];

  beforeEach(() => {
    jest.clearAllMocks();

    // Raw coordinates returned by native MediaPipe detector
    rawCoords = [];
    for (let i = 0; i < 543; i++) {
      rawCoords.push([0.1, 0.2, 0.3]);
    }

    // LandmarkNormalizer mock: identity (returns input unchanged)
    mockNormalizeFrame.mockImplementation((frame: number[][]) => frame);

    // Create a manual mock frame buffer
    mockFrames = [];
    mockFrameBuffer = {
      size: jest.fn().mockImplementation(() => mockFrames.length),
      getFrames: jest.fn().mockReturnValue(mockFrames),
      addFrame: jest.fn().mockImplementation((frame) => {
        mockFrames.push(frame);
      }),
    };

    (useRef as jest.Mock).mockReturnValue({ current: mockFrameBuffer });

    mockProcessFrame.mockReturnValue(rawCoords);
  });

  test('should return permission states and buffer capacity', () => {
    const result = useMediaPipeHolistic(30);

    expect(result.hasPermission).toBe(true);
    expect(result.frameBuffer).toBe(mockFrameBuffer);
  });

  test('should trigger requestPermission when requested', async () => {
    const result = useMediaPipeHolistic(30);
    const mockRequestPermission = (useCameraPermission as jest.Mock)().requestPermission;

    const allowed = await result.requestPermission();

    expect(mockRequestPermission).toHaveBeenCalled();
    expect(allowed).toBe(true);
  });

  test('should process camera frame through normalizer then into FrameBuffer', () => {
    const result = useMediaPipeHolistic(10);
    const mockFrame = { dispose: jest.fn() };
    const frameOutput = result.frameOutput as any;

    frameOutput.options.onFrame(mockFrame);

    // 1. Frame must be forwarded to native detector
    expect(mockProcessFrame).toHaveBeenCalledWith(mockFrame);

    // 2. Raw coordinates must pass through the normalizer
    expect(mockNormalizeFrame).toHaveBeenCalledWith(rawCoords);

    // 3. Normalized result (identity mock = rawCoords) must be buffered
    expect(mockFrameBuffer.addFrame).toHaveBeenCalledWith(rawCoords);
    expect(mockFrames.length).toBe(1);

    // 4. Frame must always be disposed
    expect(mockFrame.dispose).toHaveBeenCalled();
  });

  test('should dispose frame even when normalizer is not called (frame length mismatch)', () => {
    mockProcessFrame.mockReturnValue([[0.1, 0.2, 0.3]]); // only 1 landmark — invalid
    const result = useMediaPipeHolistic(10);
    const mockFrame = { dispose: jest.fn() };
    const frameOutput = result.frameOutput as any;

    frameOutput.options.onFrame(mockFrame);

    expect(mockNormalizeFrame).not.toHaveBeenCalled();
    expect(mockFrameBuffer.addFrame).not.toHaveBeenCalled();
    expect(mockFrame.dispose).toHaveBeenCalled();
  });

  test('should not add frame when native detector returns null', () => {
    mockProcessFrame.mockReturnValue(null);
    const result = useMediaPipeHolistic(10);
    const mockFrame = { dispose: jest.fn() };
    const frameOutput = result.frameOutput as any;

    frameOutput.options.onFrame(mockFrame);

    expect(mockNormalizeFrame).not.toHaveBeenCalled();
    expect(mockFrameBuffer.addFrame).not.toHaveBeenCalled();
    expect(mockFrame.dispose).toHaveBeenCalled();
  });
});
