const {compileNonManualChannelIntent} = require('../nonmanual-channel-intent-v1.cjs');

function source(tracks: unknown[]) {
  return {schema: 'vozual.nonmanual-channel-intent', schemaVersion: 1, id: 'fixture.task8.synthetic', revision: 1,
    durationMs: 1000, execution: 'authoring-only-not-executable', tracks};
}

describe('non-manual channel intent v1', () => {
  it('composes distinct abstract channels deterministically without emitting executable frames', () => {
    const value = source([
      {id: 'head-turn', channel: 'head.yaw', fromMs: 100, toMs: 800, intentRef: 'intent.head.turn', composition: 'exclusive-per-channel'},
      {id: 'brow-cue', channel: 'brows.leftInnerLift', fromMs: 200, toMs: 600, intentRef: 'intent.brow.cue', composition: 'exclusive-per-channel'},
    ]);
    const forward = compileNonManualChannelIntent(value);
    const reverse = compileNonManualChannelIntent({...value, tracks: [...value.tracks].reverse()});
    expect(forward.canonicalJson).toBe(reverse.canonicalJson);
    expect(forward.sha256).toBe(reverse.sha256);
    expect(forward.timeline.execution).toBe('authoring-only-not-executable');
    expect(forward.timeline.timeline).toHaveLength(2);
    expect(forward.timeline).not.toHaveProperty('frames');
  });

  it('allows adjacent cues on the same channel', () => {
    const result = compileNonManualChannelIntent(source([
      {id: 'left', channel: 'eyelids.leftClosure', fromMs: 0, toMs: 500, intentRef: 'intent.eye.closed', composition: 'exclusive-per-channel'},
      {id: 'right', channel: 'eyelids.leftClosure', fromMs: 500, toMs: 1000, intentRef: 'intent.eye.open', composition: 'exclusive-per-channel'},
    ]));
    expect(result.timeline.timeline).toHaveLength(2);
  });

  it('rejects overlapping cues on the same channel instead of guessing a blend or priority', () => {
    const first = {id: 'first', channel: 'mouthCorners.left', fromMs: 0, toMs: 600, intentRef: 'intent.corner.a', composition: 'exclusive-per-channel'};
    const second = {id: 'second', channel: 'mouthCorners.left', fromMs: 500, toMs: 900, intentRef: 'intent.corner.b', composition: 'exclusive-per-channel'};
    for (const tracks of [[first, second], [second, first]]) {
      expect(() => compileNonManualChannelIntent(source(tracks)))
        .toThrow(expect.objectContaining({code: 'NONMANUAL.CHANNEL_OVERLAP'}));
    }
  });

  it('rejects unsupported channels and combination policies at the schema boundary', () => {
    const base = {id: 'cue', channel: 'head.yaw', fromMs: 0, toMs: 500, intentRef: 'intent.head.turn', composition: 'exclusive-per-channel'};
    expect(() => compileNonManualChannelIntent(source([{...base, channel: 'face.unspecified'}])))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.INVALID_INTENT'}));
    expect(() => compileNonManualChannelIntent(source([{...base, composition: 'additive'}])))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.INVALID_INTENT'}));
  });

  it('rejects repeated IDs and out-of-duration intervals', () => {
    const cue = {id: 'same', channel: 'head.pitch', fromMs: 0, toMs: 500, intentRef: 'intent.head.pitch', composition: 'exclusive-per-channel'};
    expect(() => compileNonManualChannelIntent(source([cue, {...cue, channel: 'head.roll'}])))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.DUPLICATE_ID'}));
    expect(() => compileNonManualChannelIntent(source([{...cue, id: 'late', fromMs: 900, toMs: 1001}])))
      .toThrow(expect.objectContaining({code: 'NONMANUAL.INVALID_INTERVAL'}));
  });
});
