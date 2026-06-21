const mockProcessFrame = jest.fn();
jest.mock('react-native', () => ({
  NativeModules: {
    MediaPipeHolisticDetector: {
      processFrame: mockProcessFrame,
    },
  },
}));

import { useMediaPipeHolistic } from '../useMediaPipeHolistic';
import { useCameraPermission, useFrameOutput } from 'react-native-vision-camera';
import { useRef } from 'react';
import { NativeModules } from 'react-native';

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

  beforeEach(() => {
    jest.clearAllMocks();
    
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

    mockProcessFrame.mockImplementation(() => {
      const coords: number[][] = [];
      for (let i = 0; i < 543; i++) {
        coords.push([0.1, 0.2, 0.3]);
      }
      return coords;
    });
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

  test('should process camera frame and update FrameBuffer', () => {
    const result = useMediaPipeHolistic(10);

    const mockFrame = {
      dispose: jest.fn(),
    };

    const frameOutput = result.frameOutput as any;
    
    // Trigger onFrame callback
    frameOutput.options.onFrame(mockFrame);

    expect(mockFrame.dispose).toHaveBeenCalled();
    expect(mockProcessFrame).toHaveBeenCalledWith(mockFrame);
    expect(mockFrameBuffer.addFrame).toHaveBeenCalled();
    expect(mockFrames.length).toBe(1);
    expect(mockFrames[0][0]).toEqual([0.1, 0.2, 0.3]);
  });
});
