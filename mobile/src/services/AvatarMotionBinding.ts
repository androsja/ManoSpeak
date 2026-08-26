import {MotionFrame, MotionPoint, SignMotion} from './CompactSignMotion';

export type AvatarArmBinding = {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  handStart?: number;
};

export const AVATAR_ARMS: ReadonlyArray<Omit<AvatarArmBinding, 'handStart'>> = [
  {shoulder: 11, elbow: 13, wrist: 15, hip: 23},
  {shoulder: 12, elbow: 14, wrist: 16, hip: 24},
];

export const CAPTURED_HAND_STARTS = [33, 54] as const;

/** Selects every anatomical arm that needs a derived hand presentation. */
export function presentationArmIndexes(
  singleHandedSide?: 'L' | 'R',
): ReadonlyArray<0 | 1> {
  if (singleHandedSide === 'L') return [0];
  if (singleHandedSide === 'R') return [1];
  return [0, 1];
}

function isValid(point: MotionPoint | undefined): point is MotionPoint {
  return point != null && point.some(value => Math.abs(value) > 1e-8);
}

function squaredScreenDistance(first: MotionPoint, second: MotionPoint): number {
  // Pose and hand landmarks use independent depth estimators. Comparing Z here
  // can attach an otherwise correct hand to the opposite arm.
  return (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2;
}

/**
 * Associates captured hand blocks with the closest anatomical pose wrist.
 * MediaPipe's hand labels are not assumed to be stable or to match pose sides.
 */
export function bindHandsToArms(frame: MotionFrame): AvatarArmBinding[] {
  const bindings: AvatarArmBinding[] = AVATAR_ARMS.map(arm => ({...arm}));
  const firstHand = frame.bodyHands[CAPTURED_HAND_STARTS[0]];
  const secondHand = frame.bodyHands[CAPTURED_HAND_STARTS[1]];
  const firstWrist = frame.bodyHands[AVATAR_ARMS[0].wrist];
  const secondWrist = frame.bodyHands[AVATAR_ARMS[1].wrist];
  const hasFirst = isValid(firstHand);
  const hasSecond = isValid(secondHand);

  if (hasFirst && hasSecond && isValid(firstWrist) && isValid(secondWrist)) {
    const direct = squaredScreenDistance(firstHand, firstWrist)
      + squaredScreenDistance(secondHand, secondWrist);
    const crossed = squaredScreenDistance(firstHand, secondWrist)
      + squaredScreenDistance(secondHand, firstWrist);
    bindings[0].handStart = direct <= crossed ? CAPTURED_HAND_STARTS[0] : CAPTURED_HAND_STARTS[1];
    bindings[1].handStart = direct <= crossed ? CAPTURED_HAND_STARTS[1] : CAPTURED_HAND_STARTS[0];
  } else if ((hasFirst || hasSecond) && isValid(firstWrist) && isValid(secondWrist)) {
    const handStart = hasFirst ? CAPTURED_HAND_STARTS[0] : CAPTURED_HAND_STARTS[1];
    const hand = frame.bodyHands[handStart];
    if (isValid(hand)) {
      const armIndex = squaredScreenDistance(hand, firstWrist)
        <= squaredScreenDistance(hand, secondWrist) ? 0 : 1;
      bindings[armIndex].handStart = handStart;
    }
  }
  return bindings;
}

/**
 * Chooses one stable hand-to-arm relationship for the complete sign. Voting
 * prevents a crossing hand or one noisy frame from swapping the rigged arms.
 */
export function bindingsForMotion(motion: SignMotion): AvatarArmBinding[] {
  const votes = [
    new Map<number, number>(),
    new Map<number, number>(),
  ];
  motion.frames.forEach(frame => {
    bindHandsToArms(frame).forEach((binding, armIndex) => {
      if (binding.handStart === undefined) return;
      votes[armIndex].set(
        binding.handStart,
        (votes[armIndex].get(binding.handStart) ?? 0) + 1,
      );
    });
  });

  const score = (armIndex: number, handStart: number) => (
    votes[armIndex].get(handStart) ?? 0
  );
  const directScore = score(0, CAPTURED_HAND_STARTS[0])
    + score(1, CAPTURED_HAND_STARTS[1]);
  const crossedScore = score(0, CAPTURED_HAND_STARTS[1])
    + score(1, CAPTURED_HAND_STARTS[0]);
  const selectedStarts = directScore >= crossedScore
    ? CAPTURED_HAND_STARTS
    : [CAPTURED_HAND_STARTS[1], CAPTURED_HAND_STARTS[0]] as const;

  return AVATAR_ARMS.map((arm, armIndex) => {
    const handStart = selectedStarts[armIndex];
    return score(armIndex, handStart) > 0 ? {...arm, handStart} : {...arm};
  });
}

/** Measures only landmarks belonging to the anatomical arm after binding. */
export function armMotionScore(
  motion: SignMotion,
  armIndex: number,
  bindings = bindingsForMotion(motion),
): number {
  const binding = bindings[armIndex];
  if (!binding) return 0;
  const trackedIndexes = [binding.elbow, binding.wrist];
  if (binding.handStart !== undefined) {
    trackedIndexes.push(...Array.from(
      {length: 21},
      (_, index) => binding.handStart! + index,
    ));
  }

  let score = 0;
  const previous = new Map<number, MotionPoint>();
  motion.frames.forEach(frame => {
    trackedIndexes.forEach(index => {
      const current = frame.bodyHands[index];
      const prior = previous.get(index);
      if (isValid(current) && isValid(prior)) {
        score += squaredScreenDistance(current, prior);
      }
      if (isValid(current)) previous.set(index, current);
      else previous.delete(index);
    });
  });
  return score;
}
