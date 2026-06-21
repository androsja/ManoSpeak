export class TtsService {
  private isSpeaking: boolean = false;

  /**
   * Vocalizes text offline using native operating system synthesizers
   * or ONNX Runtime Mobile models.
   */
  public async speak(text: string): Promise<void> {
    if (!text || text.trim() === '') {
      return;
    }
    
    this.isSpeaking = true;
    console.log(`[TTS Engine] Vocalizando: "${text}"`);
    
    // Simulate speaking delay
    return new Promise((resolve) => {
      setTimeout(() => {
        this.isSpeaking = false;
        resolve();
      }, 300); // 300ms speech duration mock
    });
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
