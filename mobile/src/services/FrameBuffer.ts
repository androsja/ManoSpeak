export class FrameBuffer {
  private buffer: number[][][];
  private capacity: number;

  constructor(capacity: number = 30) {
    this.buffer = [];
    this.capacity = capacity;
  }

  /**
   * Adds a single frame of coordinates to the sliding window buffer.
   * Discards the oldest frame if the buffer capacity is exceeded.
   * Expected frame shape: 543 landmarks, each with 3 coordinates (x, y, z).
   */
  public addFrame(frame: number[][]): void {
    // Validate frame shape to prevent malformed inputs
    if (frame.length !== 543) {
      throw new Error(`Invalid frame shape: expected 543 landmarks, got ${frame.length}`);
    }
    if (frame.length > 0 && frame[0].length !== 3) {
      throw new Error(`Invalid coordinate shape: expected 3 coordinates (x,y,z), got ${frame[0].length}`);
    }

    this.buffer.push(frame);

    // Enforce sliding window (discard oldest frames when over capacity)
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  /**
   * Returns all frames currently stored in the buffer.
   */
  public getFrames(): number[][][] {
    return this.buffer;
  }

  /**
   * Returns the current size (number of frames) in the buffer.
   */
  public size(): number {
    return this.buffer.length;
  }

  /**
   * Returns whether the buffer has reached its target capacity.
   */
  public isFull(): boolean {
    return this.buffer.length === this.capacity;
  }

  /**
   * Clears all frames from the buffer.
   */
  public clear(): void {
    this.buffer = [];
  }

  /**
   * Flattens the buffer into a Float32Array to be directly fed into the TFLite inference engine.
   * Dimensions output: [capacity, 543, 3] flat.
   * If the buffer is not yet full, pads with zeros at the beginning to maintain fixed input shape.
   */
  public getFlatArray(): Float32Array {
    const flatSize = this.capacity * 543 * 3;
    const flatArray = new Float32Array(flatSize);

    const currentSize = this.buffer.length;
    const padFrames = this.capacity - currentSize;

    // Fill in the frames
    let ptr = 0;

    // 1. Pad missing frames with zeros at the beginning
    if (padFrames > 0) {
      ptr += padFrames * 543 * 3; // Leave them as default zero values
    }

    // 2. Copy the active buffer frames
    for (let f = 0; f < currentSize; f++) {
      const frame = this.buffer[f];
      for (let l = 0; l < 543; l++) {
        flatArray[ptr++] = frame[l][0]; // X
        flatArray[ptr++] = frame[l][1]; // Y
        flatArray[ptr++] = frame[l][2]; // Z
      }
    }

    return flatArray;
  }
}
