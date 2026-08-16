export type MotionPoint = [number, number, number];
export type MotionFrame = {bodyHands: MotionPoint[]; face: MotionPoint[]};
export type SignMotion = {fps: number; frames: MotionFrame[]};

const HEADER_SIZE = 16;
const MAGIC = [0x56, 0x5a, 0x4d, 0x42]; // VZMB
const FORMAT_VERSION = 2;

function assertHeader(bytes: Uint8Array): void {
  if (bytes.byteLength < HEADER_SIZE) {
    throw new Error('Compact motion is missing its header.');
  }
  if (MAGIC.some((value, index) => bytes[index] !== value)) {
    throw new Error('Compact motion has an invalid VOZUAL signature.');
  }
  if (bytes[4] !== FORMAT_VERSION) {
    throw new Error(`Unsupported compact motion version: ${bytes[4]}.`);
  }
}

export function decodeCompactMotion(bytes: Uint8Array): SignMotion {
  assertHeader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fps = view.getUint16(6, true);
  const frameCount = view.getUint16(8, true);
  const bodyPointCount = view.getUint16(10, true);
  const facePointCount = view.getUint16(12, true);
  const scale = view.getUint16(14, true);
  if (fps === 0 || frameCount === 0 || scale === 0) {
    throw new Error('Compact motion header contains zero-valued dimensions.');
  }

  const pointsPerFrame = bodyPointCount + facePointCount;
  const expectedSize = HEADER_SIZE + frameCount * pointsPerFrame * 3 * 2;
  if (bytes.byteLength !== expectedSize) {
    throw new Error(
      `Compact motion size mismatch: expected ${expectedSize}, received ${bytes.byteLength}.`,
    );
  }

  let offset = HEADER_SIZE;
  const readPoint = (): MotionPoint => {
    const point: MotionPoint = [
      view.getInt16(offset, true) / scale,
      view.getInt16(offset + 2, true) / scale,
      view.getInt16(offset + 4, true) / scale,
    ];
    offset += 6;
    return point;
  };

  const frames: MotionFrame[] = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const bodyHands = Array.from({length: bodyPointCount}, readPoint);
    const face = Array.from({length: facePointCount}, readPoint);
    frames.push({bodyHands, face});
  }
  return {fps, frames};
}

export function decodeBase64Bytes(encoded: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = encoded.replace(/\s/g, '');
  if (clean.length % 4 !== 0) {
    throw new Error('Compact motion Base64 payload has an invalid length.');
  }
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((clean.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < clean.length; index += 4) {
    const values = [0, 1, 2, 3].map(position => {
      const character = clean[index + position];
      if (character === '=') return 0;
      const value = alphabet.indexOf(character);
      if (value < 0) throw new Error('Compact motion Base64 payload is invalid.');
      return value;
    });
    const combined = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    if (outputIndex < output.length) output[outputIndex++] = (combined >> 16) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = (combined >> 8) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = combined & 0xff;
  }
  return output;
}
