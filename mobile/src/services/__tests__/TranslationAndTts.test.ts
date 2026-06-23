jest.mock('react-native', () => ({
  NativeModules: {},
}));

jest.mock('react-native-fast-tflite', () => ({
  loadTensorflowModel: jest.fn(),
}));

jest.mock('onnxruntime-react-native', () => ({
  InferenceSession: {
    create: jest.fn().mockResolvedValue({ run: jest.fn() }),
  },
  Tensor: jest.fn().mockImplementation((type, data, dims) => ({ type, data, dims })),
}));

jest.mock('../../../assets/models/tts_voice.onnx', () => 'mock-onnx-file', { virtual: true });

import { FrameBuffer } from '../FrameBuffer';
import { TranslationService } from '../TranslationService';
import { TtsService } from '../TtsService';
import { loadTensorflowModel } from 'react-native-fast-tflite';

// Build an ArrayBuffer with the given value set to 1.0 at `argmaxIdx` (all others 0).
function makeOutputBuffer(argmaxIdx: number, size: number): ArrayBuffer {
  const arr = new Float32Array(size).fill(0);
  arr[argmaxIdx] = 1.0;
  return arr.buffer;
}

function makeMockTfliteModel(hArgmax: number, lArgmax: number, mArgmax: number) {
  return {
    inputs: [],
    outputs: [],
    delegates: [],
    run: jest.fn().mockResolvedValue([
      makeOutputBuffer(hArgmax, 64),
      makeOutputBuffer(lArgmax, 32),
      makeOutputBuffer(mArgmax, 32),
    ]),
    runSync: jest.fn().mockReturnValue([]),
  };
}

describe('Translation and TTS Integration Services', () => {
  let frameBuffer: FrameBuffer;
  let translationService: TranslationService;
  let ttsService: TtsService;

  beforeEach(() => {
    frameBuffer = new FrameBuffer(5);
    translationService = new TranslationService();
    ttsService = new TtsService();
    jest.clearAllMocks();
  });

  const createMockFrame = (value: number = 1.0): number[][] => {
    const frame: number[][] = [];
    for (let i = 0; i < 543; i++) {
      frame.push([value, value, value]);
    }
    return frame;
  };

  describe('TranslationService Tests', () => {
    test('should throw error if translating before model is loaded', async () => {
      frameBuffer.addFrame(createMockFrame(1.0));
      await expect(translationService.translateFrameBuffer(frameBuffer)).rejects.toThrow(
        'Translation model is not loaded. Call loadModel() first.'
      );
    });

    test('should return empty string on empty buffer', async () => {
      (loadTensorflowModel as jest.Mock).mockResolvedValue(makeMockTfliteModel(0, 0, 0));
      await translationService.loadModel();
      const gloss = await translationService.translateFrameBuffer(frameBuffer);
      expect(gloss).toBe('');
    });

    test('should translate matching LSC recipes from dictionary', async () => {
      // lsc_dictionary.json maps "1,1,2" -> "GRACIAS".
      // TFLite outputs: handshape argmax=1 (64-class), location argmax=1 (32-class), movement argmax=2 (32-class).
      (loadTensorflowModel as jest.Mock).mockResolvedValue(makeMockTfliteModel(1, 1, 2));
      await translationService.loadModel();
      frameBuffer.addFrame(createMockFrame(1.0));

      const gloss = await translationService.translateFrameBuffer(frameBuffer);
      expect(gloss).toBe('GRACIAS');
    });

    test('should register and decode custom zero-shot recipe fallbacks', async () => {
      // Register COLOMBIA at (5, 8, 11). lsc_dictionary.json also has this key; the
      // in-memory overlay takes priority and still returns "COLOMBIA".
      (loadTensorflowModel as jest.Mock).mockResolvedValue(makeMockTfliteModel(5, 8, 11));
      await translationService.loadModel();
      translationService.registerRecipe(5, 8, 11, 'COLOMBIA');

      frameBuffer.addFrame(createMockFrame(1.0));
      const gloss = await translationService.translateFrameBuffer(frameBuffer);
      expect(gloss).toBe('COLOMBIA');
    });
  });

  describe('TtsService Tests', () => {
    test('should speak valid text and update status', async () => {
      expect(ttsService.getIsSpeaking()).toBe(false);

      const speakPromise = ttsService.speak('HOLA COLOMBIA');
      expect(ttsService.getIsSpeaking()).toBe(true);

      await speakPromise;
      expect(ttsService.getIsSpeaking()).toBe(false);
    });

    test('should stop speaking immediately when stop is called', async () => {
      const speakPromise = ttsService.speak('HOLA');
      expect(ttsService.getIsSpeaking()).toBe(true);

      await ttsService.stop();
      expect(ttsService.getIsSpeaking()).toBe(false);
      await speakPromise;
    });

    test('should not speak empty text', async () => {
      await ttsService.speak('');
      expect(ttsService.getIsSpeaking()).toBe(false);
    });
  });
});
