import Tts from 'react-native-tts';

export class TtsService {
  private isSpeaking: boolean = false;

  constructor() {
    this.initTts();
  }

  private async initTts() {
    try {
      await Tts.getInitStatus().catch((e) => console.log('Init status bypass (iOS):', e));
    } catch (e) { }

    try {
      await Tts.setDefaultLanguage('es-CO'); // Colombian Spanish
    } catch (err) {
      console.warn('[TTS Service] es-CO no disponible. Se usará el idioma por defecto.', err);
    }
    
    try {
      await Tts.setDefaultRate(0.5); // Normal speed
    } catch (err) { }
    
    console.log('[TTS Service] TTS Engine Initialized.');
  }

  /**
   * Vocalizes text out loud using the native OS speech synthesizer.
   */
  public async speak(text: string): Promise<void> {
    if (!text || text.trim() === '') {
      return;
    }
    
    // Ignore the raw query keys if the model isn't trained yet
    if (text.startsWith('[H')) {
      console.log('[TTS] Ignorando salida cruda del modelo no entrenado:', text);
      return;
    }
    
    this.isSpeaking = true;
    console.log(`[TTS Engine] Hablando en voz alta: "${text}"`);
    
    Tts.stop(); // Stop any current speech
    Tts.speak(text);

    // Simulate vocalization playback latency to prevent overlap
    return new Promise((resolve) => {
      setTimeout(() => {
        this.isSpeaking = false;
        resolve();
      }, 1000);
    });
  }

  /**
   * Stops current speech synthesis immediately.
   */
  public async stop(): Promise<void> {
    Tts.stop();
    this.isSpeaking = false;
  }

  /**
   * Returns current speaking state.
   */
  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}
