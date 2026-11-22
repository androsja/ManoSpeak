import type {MotionPoint, SignMotion} from './CompactSignMotion';

export type JsonMotionDocument = SignMotion & {
  version?: number;
  layout?: string;
  avatarProfile?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isMotionPoint(value: unknown): value is MotionPoint {
  return Array.isArray(value)
    && value.length === 3
    && value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

const FINGER_NAMES = new Set(['thumb', 'index', 'middle', 'ring', 'pinky']);
const FINGER_STATES = new Set(['captured', 'extended', 'closed']);

function isFingerStateMap(value: unknown): boolean {
  return isRecord(value) && Object.entries(value).every(([finger, state]) => (
    FINGER_NAMES.has(finger) && typeof state === 'string' && FINGER_STATES.has(state)
  ));
}

/** Validates the frame shape the Android avatar runtime can consume directly. */
export function parseJsonMotionDocument(
  value: unknown,
  sourceName = 'motion JSON',
): JsonMotionDocument {
  if (!isRecord(value)) throw new Error(`${sourceName} must be a JSON object.`);
  if (!Number.isInteger(value.fps) || (value.fps as number) < 1 || (value.fps as number) > 65_535) {
    throw new Error(`${sourceName} has an invalid FPS value.`);
  }
  if (!Array.isArray(value.frames) || value.frames.length < 2 || value.frames.length > 65_535) {
    throw new Error(`${sourceName} has an invalid frame count.`);
  }
  const firstFrame = value.frames[0];
  if (!isRecord(firstFrame) || !Array.isArray(firstFrame.bodyHands) || !Array.isArray(firstFrame.face)
      || firstFrame.bodyHands.length === 0 || firstFrame.face.length === 0) {
    throw new Error(`${sourceName} has invalid landmark dimensions.`);
  }
  const bodyPointCount = firstFrame.bodyHands.length;
  const facePointCount = firstFrame.face.length;
  value.frames.forEach((frame, frameIndex) => {
    if (!isRecord(frame) || !Array.isArray(frame.bodyHands) || !Array.isArray(frame.face)
        || frame.bodyHands.length !== bodyPointCount || frame.face.length !== facePointCount
        || !frame.bodyHands.every(isMotionPoint) || !frame.face.every(isMotionPoint)) {
      throw new Error(`${sourceName} has malformed landmarks at frame ${frameIndex}.`);
    }
  });
  if (value.avatarProfile !== undefined && !isRecord(value.avatarProfile)) {
    throw new Error(`${sourceName} has an invalid avatar profile.`);
  }
  if (isRecord(value.avatarProfile)) {
    for (const key of ['rigLeftFingerStates', 'rigRightFingerStates']) {
      if (value.avatarProfile[key] !== undefined && !isFingerStateMap(value.avatarProfile[key])) {
        throw new Error(`${sourceName} has invalid ${key}.`);
      }
    }
    for (const key of ['rigLeftFingerSplayDegrees', 'rigRightFingerSplayDegrees']) {
      const spread = value.avatarProfile[key];
      if (spread !== undefined && (
        typeof spread !== 'number'
        || !Number.isFinite(spread)
        || spread < 0
        || spread > 36
      )) throw new Error(`${sourceName} has invalid ${key}.`);
    }
  }
  return value as JsonMotionDocument;
}
