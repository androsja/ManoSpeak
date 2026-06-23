import { loadTensorflowModel } from 'react-native-fast-tflite';
import type { TfliteModel } from 'react-native-fast-tflite';
import { FrameBuffer } from './FrameBuffer';
import LSC_DICTIONARY from '../../assets/data/lsc_dictionary.json';

// Resolved to a numeric asset handle by Metro at bundle time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TFLITE_MODEL_ASSET = require('../assets/models/phonssm_quant.tflite') as number;

type LscDictionary = Record<string, string>;
const LSC_DICT = LSC_DICTIONARY as LscDictionary;

// Maps PhonSSM orthogonal parameter indices to LSC gloss strings.
// Built from training vocabulary (94 unique signs across LSC70W, LSC70AN, LSC50).
export const GLOSS_VOCAB: string[] = [
  // LSC70AN — alphabet
  'A','B','C','D','E','F','G','H','I','J','K','L','M',
  'N','NN','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  // LSC70AN — numbers
  '1','4','5','6','7','8','9','10','MIL','MILLON',
  // LSC70W — words
  'ANNOS','BUENAS','DIAS','GUSTAR','HOLA','LICOR','NOCHES','NOMBRE','TARDES','YO',
  // LSC50 — greetings & courtesy
  'GRACIAS','BUENOSDIAS','BUENASTARDES','BUENASNOCHES','ADIOS',
  'PORFAVOR','CONGUSTO','BIENVENIDO','PERDON','PERMISO',
  // LSC50 — people & family
  'FAMILIA','PERSONAS','MUJER','HOMBRE','NINO','NINA','ABUELO','TIO','HERMANO',
  // LSC50 — emotions & states
  'FELIZ','CONTENTO','TRISTE','ABURRIDO','BIEN','MAL','MASOMENOS','SENTIR','JUCIOSO','HAMBRE',
  // LSC50 — pronouns & questions
  'TU','USTEDES','QUE','CUANDO','DONDE','COMO','PORQUE','QUIEN',
  // LSC50 — verbs & misc
  'TRABAJAR','COMER','VIVIR','SENA','NOMBRE','POCO','MUCHO','TODOS','DIFERENTE',
  'COMOESTAS','NUNCA',
];

export class TranslationService {
  private tfliteModel: TfliteModel | null = null;
  private isModelLoaded = false;
  // In-memory overlay for dynamic recipe registration — takes priority over the JSON dictionary.
  private overlay: Map<string, string> = new Map();

  public async loadModel(): Promise<void> {
    try {
      this.tfliteModel = await loadTensorflowModel(TFLITE_MODEL_ASSET, []);
      this.isModelLoaded = true;
    } catch (err) {
      console.error('Failed to load PhonSSM TFLite model', err);
      throw err;
    }
  }

  public async translateFrameBuffer(frameBuffer: FrameBuffer): Promise<string> {
    if (!this.isModelLoaded || !this.tfliteModel) {
      throw new Error('Translation model is not loaded. Call loadModel() first.');
    }
    if (frameBuffer.size() === 0) {
      return '';
    }

    // Feed the padded flat buffer (shape: [capacity, 543, 3]) into the model.
    const flatArray = frameBuffer.getFlatArray();
    const outputs = await this.tfliteModel.run([flatArray.buffer as ArrayBuffer]);

    // Decode three orthogonal parameter heads: handshape (64-class), location (32-class), movement (32-class).
    const handshape = argmax(new Float32Array(outputs[0]));
    const location  = argmax(new Float32Array(outputs[1]));
    const movement  = argmax(new Float32Array(outputs[2]));

    const key = `${handshape},${location},${movement}`;
    return this.overlay.get(key) ?? LSC_DICT[key] ?? `[H${handshape}_L${location}_M${movement}]`;
  }

  public registerRecipe(handshape: number, location: number, movement: number, gloss: string): void {
    this.overlay.set(`${handshape},${location},${movement}`, gloss);
  }
}

function argmax(arr: Float32Array): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[best]) {
      best = i;
    }
  }
  return best;
}
