jest.mock('react-native', () => ({
  StyleSheet: {
    create: (styles: any) => styles,
    absoluteFill: 'absoluteFill',
  },
  Text: 'Text',
  View: 'View',
  TouchableOpacity: 'TouchableOpacity',
  ScrollView: 'ScrollView',
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Alert: { alert: jest.fn() },
  Platform: { OS: 'android' },
  Animated: {
    View: 'AnimatedView',
    Value: jest.fn().mockImplementation(() => ({
      setValue: jest.fn(),
      interpolate: jest.fn().mockReturnValue('50%'),
    })),
    parallel: jest.fn().mockReturnValue({ start: jest.fn() }),
    timing: jest.fn(),
    spring: jest.fn(),
  },
  NativeModules: {},
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp',
  MainBundlePath: '/tmp',
  copyFileAssets: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-native-tts', () => ({
  __esModule: true,
  default: {
    getInitStatus: jest.fn().mockResolvedValue(undefined),
    setDefaultLanguage: jest.fn().mockResolvedValue(undefined),
    setDefaultRate: jest.fn().mockResolvedValue(undefined),
    speak: jest.fn().mockReturnValue('mock-utterance'),
    stop: jest.fn().mockResolvedValue(true),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
}));

jest.mock('onnxruntime-react-native', () => ({
  InferenceSession: {
    create: jest.fn().mockResolvedValue({ run: jest.fn() }),
  },
  Tensor: jest.fn().mockImplementation((type, data, dims) => ({ type, data, dims })),
}));

jest.mock('../../../assets/models/tts_voice.onnx', () => 'mock-onnx-file', { virtual: true });

jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraDevice: jest.fn().mockReturnValue({ id: 'front-camera' }),
  useCameraFormat: jest.fn().mockReturnValue(undefined),
}));

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Circle: 'Circle',
  Line: 'Line',
  Polyline: 'Polyline',
}));

jest.mock('../../hooks/useMediaPipeHolistic', () => ({
  useMediaPipeHolistic: jest.fn().mockReturnValue({
    liveFps: 0,
    hasPermission: true,
    requestPermission: jest.fn(),
    frameProcessor: jest.fn(),
    handsDetected: false,
    frameCount: 0,
    waitingForRelease: false,
    captureEnabled: false,
    captureComplete: false,
    captureEndReason: null,
    captureTimestamps: [],
    captureDurationMs: 0,
    processorTargetFps: 24,
    timestampClock: 'monotonic_performance_ms',
    startCapture: jest.fn(),
    resetCapture: jest.fn(),
    frameBuffer: {
      size: jest.fn().mockReturnValue(5),
      getFrames: jest.fn().mockReturnValue([]),
      clear: jest.fn(),
    },
    rawFrameBuffer: {
      size: jest.fn().mockReturnValue(0),
      getFrames: jest.fn().mockReturnValue([]),
      clear: jest.fn(),
    },
  }),
}));

jest.mock('react', () => {
  const actualReact = jest.requireActual('react');
  return {
    ...actualReact,
    useState: (initialValue: any) => [initialValue, jest.fn()],
    useEffect: jest.fn(),
    useRef: (initialValue: any) => ({ current: initialValue }),
  };
});

import { MainScreen } from '../MainScreen';

describe('MainScreen UI Rendering', () => {
  test('should construct layout node tree with camera permission', () => {
    // Invoke component directly as a function to inspect the resulting element structure
    const tree = MainScreen({
      captureConsent: {
        version: 'creator_capture_consent_v1',
        acceptedAt: '2026-08-09T00:00:00.000Z',
        scope: 'avatar_animation_reference',
        localOnly: true,
        trainingEligible: false,
      },
      onExit: jest.fn(),
    }) as React.ReactElement;
    expect(tree).toBeDefined();
    
    // Find the title element in the children
    const containerChildren = tree.props.children;
    expect(containerChildren).toBeDefined();
    expect(Array.isArray(containerChildren)).toBe(true);
  });
});
