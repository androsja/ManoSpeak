import {kinematicRigArmBoneNames, kinematicRigElbowCommand, kinematicRigJointCommands, kinematicRigWristCommand, KinematicHandPose, riggedHandBoneName} from '../KinematicRigBinding';

const hand: KinematicHandPose = {
  wrist: {positionM: [0, 0, 0], orientationQuat: [0, 0, 0, 1]},
  joints: {
    thumb: {cmc: {flexionDeg: 10, abductionDeg: 5, twistDeg: 1}, mcp: {flexionDeg: 0}, ip: {flexionDeg: 0}},
    index: {mcp: {flexionDeg: 20, abductionDeg: 7, twistDeg: 2}, pip: {flexionDeg: 30}, dip: {flexionDeg: 40}},
    middle: {mcp: {flexionDeg: 0}, pip: {flexionDeg: 0}, dip: {flexionDeg: 0}},
    ring: {mcp: {flexionDeg: 0}, pip: {flexionDeg: 0}, dip: {flexionDeg: 0}},
    pinky: {mcp: {flexionDeg: 0}, pip: {flexionDeg: 0}, dip: {flexionDeg: 0}},
  },
};

describe('kinematicRigJointCommands', () => {
  it('maps every named anatomical joint to a rig deform bone', () => {
    const commands = kinematicRigJointCommands('left', hand);
    expect(commands).toHaveLength(15);
    expect(commands[0]).toEqual({boneName: 'DEF-thumb.01.L', rotationDeg: [10, 5, 1]});
    expect(commands[3]).toEqual({boneName: 'DEF-f_index.01.L', rotationDeg: [20, 7, 2]});
    expect(riggedHandBoneName('right')).toBe('DEF-hand.R');
  });

  it('mirrors only the abduction axis on the right hand', () => {
    expect(kinematicRigJointCommands('right', hand)[3].rotationDeg).toEqual([20, -7, 2]);
  });

  it('binds authored wrist translation and rotation as independent channels', () => {
    const first = kinematicRigWristCommand('left', hand);
    const rotated = kinematicRigWristCommand('left', {
      ...hand,
      wrist: {...hand.wrist, orientationQuat: [0, 0, 0.5, Math.sqrt(0.75)]},
    });

    expect(first.boneName).toBe('DEF-hand.L');
    expect(rotated.positionM).toEqual(first.positionM);
    expect(rotated.orientationQuat).not.toEqual(first.orientationQuat);
  });

  it('binds an optional elbow rotation without removing wrist articulation', () => {
    const articulated: KinematicHandPose = {
      ...hand,
      arm: {elbow: {rotationDeg: [0, 0, 25], space: 'body-local'}},
    };

    expect(kinematicRigElbowCommand('left', articulated)).toEqual({
      boneName: 'DEF-forearm.L',
      rotationDeg: [0, 0, 25],
      space: 'body-local',
    });
    expect(kinematicRigWristCommand('left', articulated).orientationQuat).toEqual([0, 0, 0, 1]);
    expect(kinematicRigElbowCommand('left', hand)).toBeUndefined();
  });

  it('includes intermediate deform links in deterministic arm rest resets', () => {
    expect(kinematicRigArmBoneNames('left')).toEqual([
      'DEF-upper_arm.L',
      'DEF-upper_arm.L.001',
      'DEF-forearm.L',
      'DEF-forearm.L.001',
      'DEF-hand.L',
    ]);
    expect(kinematicRigArmBoneNames('right')).toEqual([
      'DEF-upper_arm.R',
      'DEF-upper_arm.R.001',
      'DEF-forearm.R',
      'DEF-forearm.R.001',
      'DEF-hand.R',
    ]);
  });
});
