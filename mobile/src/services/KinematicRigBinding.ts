export type KinematicSide = 'left' | 'right';

export type KinematicJointPose = {
  flexionDeg: number;
  abductionDeg?: number;
  twistDeg?: number;
};

export type KinematicHandPose = {
  arm?: {
    elbow: {
      rotationDeg: readonly [number, number, number];
      space: 'body-local';
    };
  };
  wrist: {
    positionM: readonly [number, number, number];
    orientationQuat: readonly [number, number, number, number];
    orientationSpace?: 'body-local';
    palmFacingDirection?: readonly [number, number, number];
    relativeToForearmDeg?: readonly [number, number, number];
  };
  joints: {
    thumb: {cmc: KinematicJointPose; mcp: KinematicJointPose; ip: KinematicJointPose};
    index: {mcp: KinematicJointPose; pip: KinematicJointPose; dip: KinematicJointPose};
    middle: {mcp: KinematicJointPose; pip: KinematicJointPose; dip: KinematicJointPose};
    ring: {mcp: KinematicJointPose; pip: KinematicJointPose; dip: KinematicJointPose};
    pinky: {mcp: KinematicJointPose; pip: KinematicJointPose; dip: KinematicJointPose};
  };
};

export type RigJointCommand = {
  boneName: string;
  rotationDeg: readonly [number, number, number];
};

export type RigWristCommand = {
  boneName: string;
  positionM: readonly [number, number, number];
  orientationQuat: readonly [number, number, number, number];
  orientationSpace?: 'body-local';
  palmFacingDirection?: readonly [number, number, number];
  relativeToForearmDeg?: readonly [number, number, number];
};

export type RigElbowCommand = {
  boneName: string;
  rotationDeg: readonly [number, number, number];
  space: 'body-local';
};

const FINGER_BONE_PREFIX: Readonly<Record<keyof KinematicHandPose['joints'], string>> = {
  thumb: 'thumb',
  index: 'f_index',
  middle: 'f_middle',
  ring: 'f_ring',
  pinky: 'f_pinky',
};

const JOINT_ORDER: Readonly<Record<keyof KinematicHandPose['joints'], readonly string[]>> = {
  thumb: ['cmc', 'mcp', 'ip'],
  index: ['mcp', 'pip', 'dip'],
  middle: ['mcp', 'pip', 'dip'],
  ring: ['mcp', 'pip', 'dip'],
  pinky: ['mcp', 'pip', 'dip'],
};

function rigSide(side: KinematicSide): 'L' | 'R' {
  return side === 'left' ? 'L' : 'R';
}

/**
 * Maps named anatomical joints to the deform bones exported by vozual-rig-1.
 * The L/R abduction sign is mirrored so the same authored opening means an
 * anatomically outward movement on both hands.
 */
export function kinematicRigJointCommands(side: KinematicSide, hand: KinematicHandPose): RigJointCommand[] {
  const suffix = rigSide(side);
  const mirror = side === 'left' ? 1 : -1;
  return (Object.keys(FINGER_BONE_PREFIX) as Array<keyof KinematicHandPose['joints']>).flatMap(finger => (
    JOINT_ORDER[finger].map((joint, index) => {
      const pose = hand.joints[finger][joint as keyof typeof hand.joints[typeof finger]] as KinematicJointPose;
      return {
        boneName: `DEF-${FINGER_BONE_PREFIX[finger]}.${String(index + 1).padStart(2, '0')}.${suffix}`,
        rotationDeg: [pose.flexionDeg, (pose.abductionDeg ?? 0) * mirror, pose.twistDeg ?? 0],
      };
    })
  ));
}

export function riggedHandBoneName(side: KinematicSide): string {
  return `DEF-hand.${rigSide(side)}`;
}

/** Every exported deform link whose local rest transform affects arm replay. */
export function kinematicRigArmBoneNames(side: KinematicSide): string[] {
  const suffix = rigSide(side);
  return [
    `DEF-upper_arm.${suffix}`,
    `DEF-upper_arm.${suffix}.001`,
    `DEF-forearm.${suffix}`,
    `DEF-forearm.${suffix}.001`,
    riggedHandBoneName(side),
  ];
}

export function kinematicRigElbowCommand(
  side: KinematicSide,
  hand: KinematicHandPose,
): RigElbowCommand | undefined {
  if (!hand.arm) return undefined;
  return {
    boneName: `DEF-forearm.${rigSide(side)}`,
    rotationDeg: hand.arm.elbow.rotationDeg,
    space: hand.arm.elbow.space,
  };
}

/**
 * Keeps arm translation and wrist rotation as independent authored channels.
 * Repeating positionM while changing orientationQuat rotates only the hand
 * bone, allowing any sign to declare a stationary-arm wrist wave.
 */
export function kinematicRigWristCommand(side: KinematicSide, hand: KinematicHandPose): RigWristCommand {
  return {
    boneName: riggedHandBoneName(side),
    positionM: hand.wrist.positionM,
    orientationQuat: hand.wrist.orientationQuat,
    orientationSpace: hand.wrist.orientationSpace,
    palmFacingDirection: hand.wrist.palmFacingDirection,
    relativeToForearmDeg: hand.wrist.relativeToForearmDeg,
  };
}
