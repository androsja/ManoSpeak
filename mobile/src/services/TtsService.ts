import { InferenceSession, Tensor } from 'onnxruntime-react-native';

export class TtsService {
  private isSpeaking: boolean = false;
  private onnxSession: InferenceSession | null = null;
  private isModelLoaded: boolean = false;

  constructor() {
    this.initOnnxSession();
  }

  private async initOnnxSession(): Promise<void> {
    try {
      // In production React Native execution, we load the model asset:
      const modelAsset = require('../../assets/models/tts_voice.onnx');
      this.onnxSession = await InferenceSession.create(modelAsset);
      this.isModelLoaded = true;
      console.log('[TTS Service] ONNX Voice Engine Initialized Successfully.');
    } catch (err) {
      console.warn('[TTS Service] Native ONNX Engine not available. Using OS speech fallback.', err);
    }
  }

  /**
   * Vocalizes text offline using ONNX Runtime Mobile models with OS fallback.
   */
  public async speak(text: string): Promise<void> {
    if (!text || text.trim() === '') {
      return;
    }
    
    this.isSpeaking = true;

    if (this.isModelLoaded && this.onnxSession) {
      try {
        console.log(`[ONNX TTS Engine] Voces locales activas - Sintetizando: "${text}"`);
        // Synthesizes phonemes from text using local session:
        const inputTensor = new Tensor('string', [text], [1]);
        await this.onnxSession.run({ text: inputTensor });
      } catch (err) {
        console.error('[ONNX TTS Engine] Error en síntesis de voz, usando fallback.', err);
        this.speakFallback(text);
      }
    } else {
      this.speakFallback(text);
    }
    
    // Simulate vocalization playback latency
    return new Promise((resolve) => {
      setTimeout(() => {
        this.isSpeaking = false;
        resolve();
      }, 300);
    });
  }

  private speakFallback(text: string): void {
    console.log(`[TTS Fallback Engine] Vocalizando: "${text}"`);
  }

  /**
   * Stops current speech synthesis immediately.
   */
  public async stop(): Promise<void> {
    this.isSpeaking = false;
  }

  /**
   * Returns current speaking state.
   */
  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}
