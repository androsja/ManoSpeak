import {MotionFrame, MotionPoint, SignMotion} from './CompactSignMotion';

export const PHRASE_CONTINUATION_GRACE_MS = 550;
export const PHRASE_COAST_TO_REST_RATIO = 0.32;

export type SignPlaybackRange = {
  continuationStartFrame: number;
  endFrame: number;
};

export type PhraseArmBinding = {
  elbow: number;
  wrist: number;
  handStart?: number;
};

const HAND_WRIST_INDEXES = [33, 54];
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const NEUTRAL_ZONE_RATIO = 0.5;
const NEUTRAL_ZONE_TOLERANCE = 0.015;
const MAX_CONTINUATION_PREFIX_RATIO = 0.4;
const COARTICULATION_RELEASE_RATIO = 0.38;
const COARTICULATION_STRENGTH = 0.82;

function valid(point: [number, number, number] | undefined): point is [number, number, number] {
  return Boolean(point && (point[0] !== 0 || point[1] !== 0 || point[2] !== 0));
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function neutralBoundaryY(frame: MotionFrame): number | undefined {
  const shoulderY = mean(
    [frame.bodyHands[LEFT_SHOULDER], frame.bodyHands[RIGHT_SHOULDER]]
      .filter(valid)
      .map(point => point[1]),
  );
  const hipY = mean(
    [frame.bodyHands[LEFT_HIP], frame.bodyHands[RIGHT_HIP]]
      .filter(valid)
      .map(point => point[1]),
  );
  if (shoulderY === undefined || hipY === undefined || hipY <= shoulderY) return undefined;
  return shoulderY + (hipY - shoulderY) * NEUTRAL_ZONE_RATIO;
}

function capturedHandY(frame: MotionFrame): number | undefined {
  return mean(
    HAND_WRIST_INDEXES.map(index => frame.bodyHands[index])
      .filter(valid)
      .map(point => point[1]),
  );
}

function continuationStartFrame(motion: SignMotion): number {
  const firstFrame = motion.frames[0];
  const firstHandY = capturedHandY(firstFrame);
  const firstBoundaryY = neutralBoundaryY(firstFrame);
  if (firstHandY === undefined || firstBoundaryY === undefined || firstHandY <= firstBoundaryY) {
    return 0;
  }

  // A recording may begin with the signer lifting both hands from their lap.
  // During a phrase that preparation is replaced by a direct transition from
  // the preceding sign. A sign that remains in the lower signing space is not
  // trimmed because that position may be linguistically meaningful.
  const searchEnd = Math.min(
    motion.frames.length - 1,
    Math.max(1, Math.floor(motion.frames.length * MAX_CONTINUATION_PREFIX_RATIO)),
  );
  for (let index = 1; index <= searchEnd; index += 1) {
    const handY = capturedHandY(motion.frames[index]);
    const boundaryY = neutralBoundaryY(motion.frames[index]);
    if (handY !== undefined && boundaryY !== undefined && handY <= boundaryY) return index;
  }
  return 0;
}

function playbackEndFrame(motion: SignMotion): number {
  const lastIndex = motion.frames.length - 1;
  let lastCapturedIndex = lastIndex;
  while (lastCapturedIndex > 0 && capturedHandY(motion.frames[lastCapturedIndex]) === undefined) {
    lastCapturedIndex -= 1;
  }
  if (lastCapturedIndex === lastIndex) return lastIndex;

  const finalHandY = capturedHandY(motion.frames[lastCapturedIndex]);
  const finalBoundaryY = neutralBoundaryY(motion.frames[lastCapturedIndex]);
  if (
    finalHandY === undefined
    || finalBoundaryY === undefined
    || finalHandY < finalBoundaryY - NEUTRAL_ZONE_TOLERANCE
  ) {
    return lastCapturedIndex;
  }

  // Some captures finish with the hand dropping into the neutral zone and
  // then losing tracking. Stop on the preceding visible signing pose; IDLE is
  // responsible for the final return after the complete phrase.
  for (let index = lastCapturedIndex - 1; index >= 0; index -= 1) {
    const handY = capturedHandY(motion.frames[index]);
    const boundaryY = neutralBoundaryY(motion.frames[index]);
    if (
      handY !== undefined
      && boundaryY !== undefined
      && handY < boundaryY - NEUTRAL_ZONE_TOLERANCE
    ) return index;
  }
  return lastCapturedIndex;
}

export function signPlaybackRange(motion: SignMotion): SignPlaybackRange {
  const endFrame = playbackEndFrame(motion);
  return {
    continuationStartFrame: Math.min(continuationStartFrame(motion), endFrame),
    endFrame,
  };
}

function anchorIndex(frame: MotionFrame, binding: PhraseArmBinding): number | undefined {
  if (binding.handStart !== undefined && valid(frame.bodyHands[binding.handStart])) {
    return binding.handStart;
  }
  return valid(frame.bodyHands[binding.wrist]) ? binding.wrist : undefined;
}

/**
 * Creates presentation-only frames that start near the preceding hand pose
 * and converge to the untouched capture during the beginning of the sign.
 * Relative finger geometry, timestamps and every source frame remain intact.
 */
export function coarticulateSignMotion(
  motion: SignMotion,
  precedingFrame: MotionFrame,
  startFrame: number,
  endFrame: number,
  precedingBindings: readonly PhraseArmBinding[],
  targetBindings: readonly PhraseArmBinding[],
): SignMotion {
  const safeStart = Math.min(endFrame, Math.max(0, startFrame));
  const releaseFrames = Math.max(
    2,
    Math.round(Math.max(1, endFrame - safeStart) * COARTICULATION_RELEASE_RATIO),
  );
  const targetStartFrame = motion.frames[safeStart];
  const offsets = targetBindings.map((targetBinding, armIndex) => {
    const precedingBinding = precedingBindings[armIndex];
    if (!precedingBinding) return undefined;
    const fromIndex = anchorIndex(precedingFrame, precedingBinding);
    const toIndex = anchorIndex(targetStartFrame, targetBinding);
    if (fromIndex === undefined || toIndex === undefined) return undefined;
    const from = precedingFrame.bodyHands[fromIndex];
    const to = targetStartFrame.bodyHands[toIndex];
    return [
      (from[0] - to[0]) * COARTICULATION_STRENGTH,
      (from[1] - to[1]) * COARTICULATION_STRENGTH,
    ] as const;
  });

  if (offsets.every(offset => offset === undefined)) return motion;

  return {
    fps: motion.fps,
    frames: motion.frames.map((frame, frameIndex) => {
      if (frameIndex < safeStart || frameIndex > safeStart + releaseFrames) return frame;
      const linearProgress = Math.min(1, (frameIndex - safeStart) / releaseFrames);
      const smoothProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
      const influence = 1 - smoothProgress;
      const bodyHands = frame.bodyHands.map(point => [...point] as MotionPoint);

      targetBindings.forEach((binding, armIndex) => {
        const offset = offsets[armIndex];
        if (!offset) return;
        const translate = (index: number, weight: number) => {
          const point = bodyHands[index];
          if (!valid(point)) return;
          bodyHands[index] = [
            point[0] + offset[0] * influence * weight,
            point[1] + offset[1] * influence * weight,
            point[2],
          ];
        };
        translate(binding.elbow, 0.45);
        translate(binding.wrist, 0.82);
        if (binding.handStart !== undefined) {
          for (let handIndex = 0; handIndex < 21; handIndex += 1) {
            translate(binding.handStart + handIndex, 1);
          }
        }
      });
      return {
        bodyHands,
        face: frame.face,
        headOrientation: frame.headOrientation,
      };
    }),
  };
}
