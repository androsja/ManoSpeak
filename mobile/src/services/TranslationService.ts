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

    const decodedGlosses: string[] = [];
    let prevSymbol = 'BLANK';

    // Removed MOCK_DICT to prevent false 'Hola' predictions on 0,0,0

    for (let t = 0; t < T_frames; t++) {
      const h_t = argmaxSlice(hData, t * 64, 64);
      const l_t = argmaxSlice(lData, t * 32, 32);
      const m_t = argmaxSlice(mData, t * 32, 32);

      // Blank tokens are the maximum index (63 for Handshape, 31 for Location/Movement)
      if (h_t === 63 || l_t === 31 || m_t === 31) {
        prevSymbol = 'BLANK';
        continue;
      }

      const key = `${h_t},${l_t},${m_t}`;
      
      // CTC logic: collapse consecutive duplicate symbols
      if (key !== prevSymbol) {
        console.log(`[TranslationService] Predicted raw key: ${key}`);
        const gloss = this.overlay.get(key) ?? LSC_DICT[key];
        if (gloss) {
            console.log(`[TranslationService] MATCH FOUND: ${gloss}`);
            decodedGlosses.push(gloss);
        }
        prevSymbol = key;
      }
    }

    return decodedGlosses.join(' ');
  }

  public registerRecipe(handshape: number, location: number, movement: number, gloss: string): void {
    this.overlay.set(`${handshape},${location},${movement}`, gloss);
  }
}

function argmaxSlice(arr: Float32Array, offset: number, length: number): number {
  let bestIdx = 0;
  let maxVal = -Infinity;
  for (let i = 0; i < length; i++) {
    const val = arr[offset + i];
    if (val > maxVal) {
      maxVal = val;
      bestIdx = i;
    }
  }
  return bestIdx;
}
