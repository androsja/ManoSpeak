import {decodeCompactMotion} from '../CompactSignMotion';

const {compileMotion} = require('../../../tools/compact-sign-motion');

describe('compact sign motion', () => {
  it('reconstructs every landmark within the fixed quantization tolerance', () => {
    const source = {
      fps: 30,
      frames: [
        {bodyHands: [[0.123456, -0.234567, 1.5]], face: [[-1.25, 0, 3.106]]},
        {bodyHands: [[0.987654, 0.456789, -2.75]], face: [[0.25, -0.5, 0.75]]},
      ],
    };

    const encoded: Buffer = compileMotion(source);
    const decoded = decodeCompactMotion(new Uint8Array(encoded));

    expect(decoded.fps).toBe(source.fps);
    expect(decoded.frames).toHaveLength(source.frames.length);
    source.frames.forEach((frame, frameIndex) => {
      [...frame.bodyHands, ...frame.face].forEach((point, pointIndex) => {
        const decodedPoints = [
          ...decoded.frames[frameIndex].bodyHands,
          ...decoded.frames[frameIndex].face,
        ];
        point.forEach((coordinate, coordinateIndex) => {
          expect(Math.abs(decodedPoints[pointIndex][coordinateIndex] - coordinate)).toBeLessThanOrEqual(0.00005);
        });
      });
    });
  });

  it('rejects coordinates that cannot be represented safely', () => {
    expect(() => compileMotion({
      fps: 30,
      frames: [{bodyHands: [[4, 0, 0]], face: [[0, 0, 0]]}],
    })).toThrow('outside the compact range');
  });
});
