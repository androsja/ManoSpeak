import { FrameBuffer } from '../FrameBuffer';

describe('FrameBuffer Sliding Window Queue', () => {
  const capacity = 5;
  let frameBuffer: FrameBuffer;

  beforeEach(() => {
    frameBuffer = new FrameBuffer(capacity);
  });

  const createMockFrame = (value: number = 1.0): number[][] => {
    const frame: number[][] = [];
    for (let i = 0; i < 543; i++) {
      frame.push([value, value, value]);
    }
    return frame;
  };

  test('should initialize with correct capacity and empty size', () => {
    expect(frameBuffer.size()).toBe(0);
    expect(frameBuffer.isFull()).toBe(false);
  });

  test('should add frames and increase size', () => {
    const frame = createMockFrame(1.0);
    frameBuffer.addFrame(frame);
    expect(frameBuffer.size()).toBe(1);
    expect(frameBuffer.getFrames()[0]).toBe(frame);
  });

  test('should discard older frames when capacity is exceeded (sliding window FIFO)', () => {
    // Add frames 1 to 5
    for (let i = 1; i <= capacity; i++) {
      frameBuffer.addFrame(createMockFrame(i));
    }
    expect(frameBuffer.size()).toBe(capacity);
    expect(frameBuffer.isFull()).toBe(true);

    // Verify first is frame 1 and last is frame 5
    let frames = frameBuffer.getFrames();
    expect(frames[0][0][0]).toBe(1);
    expect(frames[capacity - 1][0][0]).toBe(5);

    // Add frame 6
    frameBuffer.addFrame(createMockFrame(6));
    expect(frameBuffer.size()).toBe(capacity);
    expect(frameBuffer.isFull()).toBe(true);

    // Verify frame 1 was discarded, first is now frame 2, last is frame 6
    frames = frameBuffer.getFrames();
    expect(frames[0][0][0]).toBe(2);
    expect(frames[capacity - 1][0][0]).toBe(6);
  });

  test('should throw error on invalid frame landmark count', () => {
    const invalidFrame = [[1.0, 1.0, 1.0]]; // Only 1 landmark instead of 543
    expect(() => {
      frameBuffer.addFrame(invalidFrame);
    }).toThrow('Invalid frame shape: expected 543 landmarks');
  });

  test('should throw error on invalid landmark coordinate count', () => {
    const invalidFrame: number[][] = [];
    for (let i = 0; i < 543; i++) {
      invalidFrame.push([1.0, 1.0]); // 2 coordinates instead of 3
    }
    expect(() => {
      frameBuffer.addFrame(invalidFrame);
    }).toThrow('Invalid coordinate shape: expected 3 coordinates');
  });

  test('should output correctly padded flat float array', () => {
    // Add 2 frames out of capacity 5
    frameBuffer.addFrame(createMockFrame(10.0));
    frameBuffer.addFrame(createMockFrame(20.0));

    const flat = frameBuffer.getFlatArray();
    expect(flat.length).toBe(capacity * 543 * 3);

    // First 3 frames should be padded zeros (padFrames = 3)
    const padSize = 3 * 543 * 3;
    for (let i = 0; i < padSize; i++) {
      expect(flat[i]).toBe(0.0);
    }

    // Frame 4 should be 10.0 (starts at padSize)
    expect(flat[padSize]).toBe(10.0);

    // Frame 5 should be 20.0 (starts at padSize + 543 * 3)
    expect(flat[padSize + 543 * 3]).toBe(20.0);
  });

  test('should clear the buffer completely', () => {
    frameBuffer.addFrame(createMockFrame(1));
    frameBuffer.addFrame(createMockFrame(2));
    expect(frameBuffer.size()).toBe(2);

    frameBuffer.clear();
    expect(frameBuffer.size()).toBe(0);
    expect(frameBuffer.getFrames()).toEqual([]);
  });
});
