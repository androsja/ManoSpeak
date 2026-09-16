const profiles = require('../../../assets/motions/avatar_profile_overrides.json');

describe('CARNE avatar profile', () => {
  it('keeps the palm stable while only the index and middle fingers extend', () => {
    expect(profiles.CARNE).toEqual(expect.objectContaining({
      rigLeftHandShape: 'fully-open',
      rigLeftHandTrackingRepair: 'locked-palm',
      rigLeftFingerStates: {
        thumb: 'closed',
        index: 'extended',
        middle: 'extended',
        ring: 'closed',
        pinky: 'closed',
      },
    }));
    expect(profiles.CARNE.rigLeftIndexMiddleSpread).toBeGreaterThan(0);

    profiles.CARNE.rigHandKeyframes.forEach((keyframe: {
      left: {fingerJoints: {index: number[]}};
    }) => {
      expect(keyframe.left.fingerJoints.index).toEqual([0, 0, 0]);
    });
  });
});
