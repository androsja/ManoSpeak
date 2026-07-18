jest.mock('react-native', () => ({
  NativeModules: {},
}));

jest.mock('onnxruntime-react-native', () => ({
  InferenceSession: { create: jest.fn() },
  Tensor: jest.fn().mockImplementation((type, data, dims) => ({ type, data, dims })),
}));

jest.mock('../../../assets/models/phonssm.onnx', () => 'mock-phonssm', { virtual: true });
jest.mock('../../../assets/models/tts_voice.onnx', () => 'mock-tts', { virtual: true });

import { FrameBuffer } from '../FrameBuffer';
import { TranslationService } from '../TranslationService';
import { TtsService } from '../TtsService';
import { InferenceSession, Tensor } from 'onnxruntime-react-native';

function makeOnnxSession(hArgmax: number, lArgmax: number, mArgmax: number) {
  const makeData = (idx: number, size: number): Float32Array => {
    const arr = new Float32Array(size);
    arr[idx] = 1.0;
    return arr;
  };
    return {
      run: jest.fn().mockResolvedValue({
        handshape: { data: makeData(hArgmax, 64), dims: [1, 1, 64] },
        location:  { data: makeData(lArgmax, 32), dims: [1, 1, 32] },
        movement:  { data: makeData(mArgmax, 32), dims: [1, 1, 32] },
      }),
    };
}

describe('Translation and TTS Integration Services', () => {
  let frameBuffer: FrameBuffer;
  let translationService: TranslationService;
  let ttsService: TtsService;

  const createMockFrame = (value = 1.0): number[][] =>
    Array.from({ length: 543 }, () => [value, value, value]);

  beforeEach(() => {
    (InferenceSession.create as jest.Mock).mockResolvedValue({ run: jest.fn() });
    frameBuffer = new FrameBuffer(5);
    translationService = new TranslationService();
    ttsService = new TtsService();
    jest.clearAllMocks();
    (InferenceSession.create as jest.Mock).mockResolvedValue({ run: jest.fn() });
  });

  describe('TranslationService', () => {
    test('throws if translating before model is loaded', async () => {
      frameBuffer.addFrame(createMockFrame());
      await expect(translationService.translateFrameBuffer(frameBuffer)).rejects.toThrow(
        'Translation model is not loaded. Call loadModel() first.'
      );
    });

    test('returns empty string on empty buffer', async () => {
      await translationService.loadModel();
      const gloss = await translationService.translateFrameBuffer(frameBuffer);
      expect(gloss).toBe('');
    });

    test('translates matching key from LSC dictionary', async () => {
      // GRACIAS is at (40, 6, 1) in lsc_dictionary.json (from phonological_labels.py)
      (InferenceSession.create as jest.Mock).mockResolvedValue(makeOnnxSession(40, 6, 1));
      await translationService.loadModel();
      frameBuffer.addFrame(createMockFrame());

      const gloss = await translationService.translateFrameBuffer(frameBuffer);
      expect(gloss).toBe('GRACIAS');
    });

    test('registers and decodes custom zero-shot recipe', async () => {
      (InferenceSession.create as jest.Mock).mockResolvedValue(makeOnnxSession(5, 8, 11));
      await translationService.loadModel();
      translationService.registerRecipe(5, 8, 11, 'COLOMBIA');

      frameBuffer.addFrame(createMockFrame());
      expect(await translationService.translateFrameBuffer(frameBuffer)).toBe('COLOMBIA');
    });

    test('passes correct float32 tensor dims to ONNX session', async () => {
      (InferenceSession.create as jest.Mock).mockResolvedValue(makeOnnxSession(0, 0, 0));
      await translationService.loadModel();
      frameBuffer.addFrame(createMockFrame());
      await translationService.translateFrameBuffer(frameBuffer);

      expect(Tensor).toHaveBeenCalledTimes(1);
      const [type, data, dims] = (Tensor as jest.Mock).mock.calls[0];
      expect(type).toBe('float32');
      expect(dims).toEqual([1, 5, 543, 3]);
      expect(data).toBeInstanceOf(Float32Array);
      expect((data as Float32Array).length).toBe(5 * 543 * 3);
    });

    test('returns fallback format when key is absent from dictionary', async () => {
      // (63, 31, 31) is outside all phonological label ranges — not in dictionary
      (InferenceSession.create as jest.Mock).mockResolvedValue(makeOnnxSession(63, 31, 31));
      await translationService.loadModel();
      frameBuffer.addFrame(createMockFrame());

      expect(await translationService.translateFrameBuffer(frameBuffer)).toBe('[H63_L31_M31]');
    });

    test('overlay takes priority over dictionary for same key', async () => {
      (InferenceSession.create as jest.Mock).mockResolvedValue(makeOnnxSession(40, 6, 1));
      await translationService.loadModel();
      translationService.registerRecipe(40, 6, 1, 'CUSTOM_OVERRIDE');

      frameBuffer.addFrame(createMockFrame());
      expect(await translationService.translateFrameBuffer(frameBuffer)).toBe('CUSTOM_OVERRIDE');
    });
  });

  describe('TtsService', () => {
    test('speaks valid text and updates speaking state', async () => {
      expect(ttsService.getIsSpeaking()).toBe(false);
      const speakPromise = ttsService.speak('HOLA COLOMBIA');
      expect(ttsService.getIsSpeaking()).toBe(true);
      await speakPromise;
      expect(ttsService.getIsSpeaking()).toBe(false);
    });

    test('stops speaking immediately when stop is called', async () => {
      const speakPromise = ttsService.speak('HOLA');
      expect(ttsService.getIsSpeaking()).toBe(true);
      await ttsService.stop();
      expect(ttsService.getIsSpeaking()).toBe(false);
      await speakPromise;
    });

    test('does not speak empty text', async () => {
      await ttsService.speak('');
      expect(ttsService.getIsSpeaking()).toBe(false);
    });
  });
});
