jest.mock('react-native', () => ({
  NativeModules: {},
}));

jest.mock('onnxruntime-react-native', () => ({
  InferenceSession: {
    create: jest.fn().mockResolvedValue({
      run: jest.fn().mockResolvedValue({}),
    }),
  },
  Tensor: jest.fn().mockImplementation((type, data, dims) => ({
    type,
    data,
    dims,
  })),
}));

jest.mock('../../../assets/models/tts_voice.onnx', () => 'mock-onnx-file', { virtual: true });

import { FrameBuffer } from '../FrameBuffer';
import { TranslationService } from '../TranslationService';
import { TtsService } from '../TtsService';

describe('Translation and TTS Integration Services', () => {
  let frameBuffer: FrameBuffer;
  let translationService: TranslationService;
  let ttsService: TtsService;

  beforeEach(() => {
    frameBuffer = new FrameBuffer(5);
    translationService = new TranslationService();
    ttsService = new TtsService();
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
      await translationService.loadModel();
      const gloss = await translationService.translateFrameBuffer(frameBuffer);
      expect(gloss).toBe('');
    });

    test('should translate matching LSC recipes from dictionary', async () => {
      await translationService.loadModel();

      // Handshape 1, Location 1, Movement 2 -> "GRACIAS"
      // Checksum target calculation:
      // sum = flatInput.reduce((a,b)=>a+b, 0)
      // handshape = round(sum) % 64
      // Let's force sum to equal 1.0 by choosing coordinates carefully.
      // Since size is 543 * 3 = 1629 coordinates per frame.
      // If each coordinate value is 1.0 / 1629 = 0.0006138735, then sum of 1 frame is exactly 1.0!
      const val = 1.0 / (543 * 3);
      frameBuffer.addFrame(createMockFrame(val));

      const gloss = await translationService.translateFrameBuffer(frameBuffer);
      expect(gloss).toBe('GRACIAS');
    });

    test('should register and decode custom zero-shot recipe fallbacks', async () => {
      await translationService.loadModel();

      // Let's register a custom LSC sign for "COLOMBIA"
      // Handshape 5, Location 8, Movement 11
      translationService.registerRecipe(5, 8, 11, 'COLOMBIA');

      // Force sum to equal 5.0 -> value = 5.0 / 1629
      const val = 5.0 / (543 * 3);
      frameBuffer.addFrame(createMockFrame(val));

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
