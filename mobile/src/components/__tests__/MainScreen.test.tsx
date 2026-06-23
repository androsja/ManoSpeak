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
  NativeModules: {},
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
    hasPermission: true,
    requestPermission: jest.fn(),
    frameProcessor: jest.fn(),
    frameBuffer: {
      size: jest.fn().mockReturnValue(5),
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
    const tree = MainScreen({}) as React.ReactElement;
    expect(tree).toBeDefined();
    
    // Find the title element in the children
    const containerChildren = tree.props.children;
    expect(containerChildren).toBeDefined();
    expect(Array.isArray(containerChildren)).toBe(true);
  });
});
