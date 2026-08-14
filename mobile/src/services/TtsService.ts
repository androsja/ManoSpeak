import Tts from 'react-native-tts';

export class TtsService {
  private isSpeaking: boolean = false;
  private finishCurrentSpeech: (() => void) | null = null;
  private currentUtteranceId: string | number | null = null;

  constructor() {
    Tts.addEventListener('tts-finish', this.handleSpeechTerminal);
    Tts.addEventListener('tts-cancel', this.handleSpeechTerminal);
    this.initTts();
  }

  private handleSpeechTerminal = (event: { utteranceId: string | number }) => {
    if (String(event.utteranceId) === String(this.currentUtteranceId)) {
      this.finishCurrentSpeech?.();
    }
  };

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
    
    this.finishCurrentSpeech?.();
    this.isSpeaking = true;
    await Tts.stop();
    console.log(`[TTS Engine] Hablando en voz alta: "${text}"`);

    return new Promise((resolve) => {
      let fallbackTimer: ReturnType<typeof setTimeout>;

      const finish = () => {
        clearTimeout(fallbackTimer);
        this.isSpeaking = false;
        this.currentUtteranceId = null;
        if (this.finishCurrentSpeech === finish) this.finishCurrentSpeech = null;
        resolve();
      };
      this.currentUtteranceId = Tts.speak(text);
      this.finishCurrentSpeech = finish;

      const wordCount = text.trim().split(/\s+/).length;
      fallbackTimer = setTimeout(finish, Math.max(4000, wordCount * 1000));
    });
  }

  /**
   * Stops current speech synthesis immediately.
   */
  public async stop(): Promise<void> {
    this.finishCurrentSpeech?.();
    this.currentUtteranceId = null;
    await Tts.stop();
    this.isSpeaking = false;
  }

  /**
   * Returns current speaking state.
   */
  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}
