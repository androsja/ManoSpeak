import hola from '../../../assets/motions/hola.motion.json';
import semanticV1 from '../../../../schemas/fixtures/motion-semantics-v1/hola.semantic.json';
import semanticV2 from '../../../../schemas/fixtures/motion-semantics-v2/valid-bilateral.semantic.json';
import invalidSemanticV2 from '../../../../schemas/fixtures/motion-semantics-v2/invalid-untyped-anatomy.semantic.json';
import {
  parseLegacyMotionDocument,
  validateLegacyMotionSemantic,
} from '../LegacyMotionLoader';

describe('LegacyMotionLoader', () => {
  it('accepts legacy motions without semantic metadata', () => {
    const motion = parseLegacyMotionDocument({fps: hola.fps, frames: hola.frames});

    expect(motion.semantic).toBeUndefined();
    expect(motion.frames).toBe(hola.frames);
    expect(motion.frames[0].bodyHands).toBe(hola.frames[0].bodyHands);
    expect(motion.frames[0].face).toBe(hola.frames[0].face);
  });

  it('validates and exposes an optional semantic block', () => {
    const source = {...hola, semantic: semanticV1};
    const motion = parseLegacyMotionDocument(source, 'hola.motion.json');

    expect(motion.semantic).toBe(semanticV1);
    expect(motion.frames).toBe(hola.frames);
    expect(motion.avatarProfile).toBe(hola.avatarProfile);
  });

  it('validates and exposes optional v2 metadata without changing legacy playback fields', () => {
    const source = {...hola, semantic: semanticV2};
    const motion = parseLegacyMotionDocument(source, 'hola-v2.motion.json');

    expect(motion.semantic).toBe(semanticV2);
    expect(motion.frames).toBe(hola.frames);
    expect(motion.frames[0].bodyHands).toBe(hola.frames[0].bodyHands);
    expect(motion.frames[0].face).toBe(hola.frames[0].face);
    expect(motion.avatarProfile).toBe(hola.avatarProfile);
  });

  it('rejects malformed semantic metadata without touching frame data', () => {
    const source = {...hola, semantic: {...semanticV1, schemaVersion: 99}};

    expect(() => parseLegacyMotionDocument(source, 'bad.motion.json'))
      .toThrow('bad.motion.json has invalid semantic metadata');
    expect(() => validateLegacyMotionSemantic(null)).toThrow('invalid semantic metadata');
  });

  it('rejects invalid v2 metadata without changing source frames', () => {
    const source = {...hola, semantic: invalidSemanticV2};

    expect(() => parseLegacyMotionDocument(source, 'bad-v2.motion.json'))
      .toThrow('bad-v2.motion.json has invalid semantic metadata');
    expect(source.frames).toBe(hola.frames);
    expect(source.frames[0].bodyHands).toBe(hola.frames[0].bodyHands);
    expect(source.frames[0].face).toBe(hola.frames[0].face);
  });
});
