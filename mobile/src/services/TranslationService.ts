import { InferenceSession, Tensor } from 'onnxruntime-react-native';
import { FrameBuffer } from './FrameBuffer';
import LSC_DICTIONARY from '../../assets/data/lsc_dictionary.json';

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

type LscDictionary = Record<string, string>;
const LSC_DICT = LSC_DICTIONARY as LscDictionary;

export class TranslationService {
  private session: InferenceSession | null = null;
  private isModelLoaded = false;
  private overlay: Map<string, string> = new Map();

  public async loadModel(): Promise<void> {
    try {
      let modelPath = '';
      if (Platform.OS === 'android') {
        modelPath = `${RNFS.DocumentDirectoryPath}/phonssm_fp32.onnx`;
        // Always overwrite during development so we get the fresh AI model
        await RNFS.copyFileAssets('models/phonssm_fp32.onnx', modelPath);
      } else {
        modelPath = `${RNFS.MainBundlePath}/models/phonssm_fp32.onnx`;
      }
      
      this.session = await InferenceSession.create(modelPath);
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

    // flatArray shape: [capacity × 543 × 3]
    const flatArray = frameBuffer.getFlatArray();
    const frames = flatArray.length / (543 * 3);
    const inputTensor = new Tensor('float32', flatArray, [1, frames, 543, 3]);

    const result = await this.session.run({ landmarks: inputTensor });

    const hDims = result['handshape'].dims; // [1, T, 64]
    const T_frames = hDims[1];

    const hData = result['handshape'].data as Float32Array;
    const lData = result['location'].data as Float32Array;
    const mData = result['movement'].data as Float32Array;

    // Each CTC head may emit its non-blank peak at a different frame. Pool each
    // head independently across the window before composing the phonological key.
    const handshape = strongestNonblankClass(hData, T_frames, 64, 63);
    const location = strongestNonblankClass(lData, T_frames, 32, 31);
    const movement = strongestNonblankClass(mData, T_frames, 32, 31);
    const key = `${handshape},${location},${movement}`;

    console.log(`[TranslationService] Predicted pooled key: ${key}`);
    const gloss = this.overlay.get(key) ?? LSC_DICT[key] ?? '';
    if (gloss) {
      console.log(`[TranslationService] MATCH FOUND: ${gloss}`);
    }
    return gloss;
  }

  public registerRecipe(handshape: number, location: number, movement: number, gloss: string): void {
    this.overlay.set(`${handshape},${location},${movement}`, gloss);
  }
}

function strongestNonblankClass(
  data: Float32Array,
  frames: number,
  classCount: number,
  blankIndex: number,
): number {
  let strongestClass = 0;
  let strongestLogit = -Infinity;
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * classCount;
    for (let classIndex = 0; classIndex < blankIndex; classIndex++) {
      const logit = data[offset + classIndex];
      if (logit > strongestLogit) {
        strongestLogit = logit;
        strongestClass = classIndex;
      }
    }
  }
  return strongestClass;
}
