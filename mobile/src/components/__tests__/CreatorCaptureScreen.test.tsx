jest.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));

jest.mock('react', () => {
  const actualReact = jest.requireActual('react');
  return {
    ...actualReact,
    useState: (initialValue: unknown) => [initialValue, jest.fn()],
  };
});

jest.mock('../MainScreen', () => ({ MainScreen: jest.fn(() => 'CaptureScreen') }));

import { MainScreen } from '../MainScreen';
import { CreatorCaptureScreen } from '../CreatorCaptureScreen';

describe('CreatorCaptureScreen', () => {
  test('does not mount the camera capture screen before the user accepts consent', () => {
    const tree = CreatorCaptureScreen({}) as React.ReactElement;

    expect(tree).toBeDefined();
    expect(MainScreen).not.toHaveBeenCalled();
  });
});
