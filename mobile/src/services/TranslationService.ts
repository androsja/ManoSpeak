import { FrameBuffer } from './FrameBuffer';

export class TranslationService {
  private isModelLoaded: boolean = false;
  
  // Zero-shot dictionary recipes mapping physical parameter indices to LSC words (glosas)
  private dictionary: Map<string, string> = new Map();

  public async loadModel(): Promise<void> {
    try {
      // Load LSC dictionary recipes asynchronously from assets JSON
      const dictData = require('../../assets/data/lsc_dictionary.json');
      for (const [key, value] of Object.entries(dictData)) {
        this.dictionary.set(key, value as string);
      }
      this.isModelLoaded = true;
    } catch (err) {
      console.error('Failed to load LSC dictionary', err);
      throw err;
    }
  }

  public async translateFrameBuffer(frameBuffer: FrameBuffer): Promise<string> {
    if (!this.isModelLoaded) {
      throw new Error('Translation model is not loaded. Call loadModel() first.');
    }

    const flatInput = frameBuffer.getFlatArray();

    // 1. In real mobile app, this runs the TFLite interpreter:
    // const outputs = await TfliteInterpreter.run(flatInput);
    //
    // 2. Here we simulate the network output by processing the input features.
    // We compute a simple checksum of non-zero frame inputs to map to dictionary recipes.
    let sum = 0;
    for (let i = 0; i < flatInput.length; i++) {
      sum += flatInput[i];
    }

    // If inputs are completely zero (empty buffer), return empty string
    if (frameBuffer.size() === 0 || Math.abs(sum) < 1e-5) {
      return '';
    }

    // Decode mock parameters
    const handshape = Math.abs(Math.round(sum)) % 64;
    const location = Math.abs(Math.round(sum * 1.5)) % 32;
    const movement = Math.abs(Math.round(sum * 2.1)) % 32;

    // Check if the recipe matches our LSC Zero-shot dictionary
    const recipeKey = `${handshape},${location},${movement}`;
    const matchedGloss = this.dictionary.get(recipeKey);

    if (matchedGloss) {
      return matchedGloss;
    }

    // Default zero-shot fallback: construct descriptive gloss from parameters
    return `[SEÑA_H${handshape}_L${location}_M${movement}]`;
  }

  /**
   * Helper to set custom dictionary entries for testing.
   */
  public registerRecipe(handshape: number, location: number, movement: number, gloss: string): void {
    this.dictionary.set(`${handshape},${location},${movement}`, gloss);
  }
}
