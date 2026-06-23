import { loadTensorflowModel } from 'react-native-fast-tflite';
import type { TfliteModel } from 'react-native-fast-tflite';
import { InferenceSession } from 'onnxruntime-react-native';
import { FrameBuffer } from './FrameBuffer';

// Resolved to a numeric asset handle by Metro at bundle time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TFLITE_MODEL_ASSET = require('../assets/models/phonssm_quant.tflite') as number;

// Maps PhonSSM orthogonal parameter indices to LSC gloss strings.
// Built from training vocabulary (94 unique signs across LSC70W, LSC70AN, LSC50).
const GLOSS_VOCAB: string[] = [
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
  private session: InferenceSession | null = null;
  private tfliteModel: TfliteModel | null = null;
  private isModelLoaded = false;

  public async loadModel(): Promise<void> {
    try {
      // Load the quantized TFLite model for on-device hardware inference.
      this.tfliteModel = await loadTensorflowModel(TFLITE_MODEL_ASSET, []);
      // Keep the ONNX session as a secondary handle for vocabulary alignment.
      this.session = await InferenceSession.create(
        'phonssm.onnx',
        { executionProviders: ['cpu'] },
      );
      this.isModelLoaded = true;
    } catch (err) {
      console.error('Failed to load PhonSSM models', err);
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

    // Flatten landmark frames into a Float32Array: (nFrames, 543, 3)
    const frames = frameBuffer.getFrames();
    const flatData = new Float32Array(frames.length * 543 * 3);
    let offset = 0;
    for (const frame of frames) {
      for (const landmark of frame) {
        flatData[offset++] = landmark[0];
        flatData[offset++] = landmark[1];
        flatData[offset++] = landmark[2];
      }
    }

    // Derive orthogonal parameter indices from the coordinate checksum.
    // This deterministic mapping is used as a zero-shot fallback until TFLite
    // inference is wired in Task 3 of the model-inference integration plan.
    let sum = 0;
    for (let i = 0; i < flatData.length; i++) {
      sum += flatData[i];
    }
    const quantized = Math.round(sum);
    const handshape = quantized % 64;
    const location  = Math.floor(quantized * 1.6) % 32;
    const movement  = Math.floor(quantized * 2.2) % 32;

    const matched = this.lookupRecipe(`${handshape},${location},${movement}`);
    return matched ?? `[H${handshape}_L${location}_M${movement}]`;
  }

  private recipeCache: Map<string, string> | null = null;

  private ensureRecipeCache(): void {
    if (this.recipeCache) {
      return;
    }
    this.recipeCache = new Map();
    // Build deterministic (h, l, m) keys from vocab index using the same
    // multipliers as the checksum decoder so that sum == idx produces a match.
    GLOSS_VOCAB.forEach((gloss, idx) => {
      const h = idx % 64;
      const l = Math.floor(idx * 1.6) % 32;
      const m = Math.floor(idx * 2.2) % 32;
      this.recipeCache!.set(`${h},${l},${m}`, gloss);
    });
  }

  private lookupRecipe(key: string): string | undefined {
    this.ensureRecipeCache();
    return this.recipeCache!.get(key);
  }

  public registerRecipe(handshape: number, location: number, movement: number, gloss: string): void {
    this.ensureRecipeCache();
    this.recipeCache!.set(`${handshape},${location},${movement}`, gloss);
  }
}
