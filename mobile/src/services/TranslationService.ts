import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { FrameBuffer } from './FrameBuffer';
import LSC_DICTIONARY from '../../assets/data/lsc_dictionary.json';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PHONSSM_MODEL = require('../../assets/models/phonssm.onnx') as number;

type LscDictionary = Record<string, string>;
const LSC_DICT = LSC_DICTIONARY as LscDictionary;

export class TranslationService {
  private session: InferenceSession | null = null;
  private isModelLoaded = false;
  private overlay: Map<string, string> = new Map();

  public async loadModel(): Promise<void> {
    try {
      this.session = await InferenceSession.create(PHONSSM_MODEL);
      this.isModelLoaded = true;
    } catch (err) {
      console.error('[TranslationService] Failed to load PhonSSM ONNX model', err);
      throw err;
    }
  }

  public async translateFrameBuffer(frameBuffer: FrameBuffer): Promise<string> {
    if (!this.isModelLoaded || !this.session) {
      throw new Error('Translation model is not loaded. Call loadModel() first.');
    }
    if (frameBuffer.size() === 0) {
      return '';
    }

    // flatArray shape: [capacity × 543 × 3] — already zero-padded by FrameBuffer.
    const flatArray = frameBuffer.getFlatArray();
    const frames = flatArray.length / (543 * 3);
    const inputTensor = new Tensor('float32', flatArray, [1, frames, 543, 3]);

    const result = await this.session.run({ landmarks: inputTensor });

    const h = argmax(result['handshape'].data as Float32Array);
    const l = argmax(result['location'].data as Float32Array);
    const m = argmax(result['movement'].data as Float32Array);

    const key = `${h},${l},${m}`;
    return this.overlay.get(key) ?? LSC_DICT[key] ?? `[H${h}_L${l}_M${m}]`;
  }

  public registerRecipe(handshape: number, location: number, movement: number, gloss: string): void {
    this.overlay.set(`${handshape},${location},${movement}`, gloss);
  }
}

function argmax(arr: Float32Array): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[best]) best = i;
  }
  return best;
}
