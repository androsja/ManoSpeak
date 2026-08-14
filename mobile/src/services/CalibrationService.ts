import RNFS from 'react-native-fs';
import { LandmarkNormalizer } from './LandmarkNormalizer';

export type DiagnosticSpeed = 'fast' | 'natural' | 'slow';

export interface CreatorCaptureConsent {
  version: 'creator_capture_consent_v1';
  acceptedAt: string;
  scope: 'avatar_animation_reference';
  localOnly: true;
  trainingEligible: false;
}

export interface DiagnosticCaptureMetadata {
  platform: 'android' | 'ios';
  cameraPosition: 'front';
  cameraDeviceId: string;
  rotationDegrees: number;
  horizontallyMirrored: boolean;
  previewVisible: boolean;
  mediaPipeTasksVersion: string;
  processorTargetFps: number;
  timestampClock: 'monotonic_performance_ms';
  landmarkLayout: 'pose33_left21_right21_face468';
  normalizer: 'shoulder_center_scale_clip_v1';
  purpose: 'creator_reference';
  consent: CreatorCaptureConsent;
}

export interface CalibrationQuality {
  valid: boolean;
  reasons: string[];
  frameCount: number;
  durationMs: number;
  effectiveFps: number;
  maxFrameGapMs: number;
  estimatedDroppedFrames: number;
  shoulderFrameRatio: number;
  handFrameRatio: number;
  activeFrameCount: number;
  activeDurationMs: number;
  firstHandFrameIndex: number;
  lastHandFrameIndex: number;
  preRollFrameCount: number;
  postRollFrameCount: number;
  wristTravel: number;
  normalizedMaxAbs: number;
  normalizationMaxError: number;
}

interface DiagnosticSample {
  version: 3;
  purpose: 'creator_reference';
  trainingEligible: false;
  gloss: string;
  requestedSpeed: DiagnosticSpeed;
  createdAt: string;
  endReason: 'hand_release' | 'max_duration';
  capture: DiagnosticCaptureMetadata;
  timestamps: number[];
  handPresence: boolean[];
  quality: CalibrationQuality;
  rawFrames: number[][][];
  normalizedFrames: number[][][];
}

// Channel-malfunction floor, not an aspirational target. The Pixel 10a channel
// sustains ~8.7 FPS with a subject in frame (GPU delegate active, 384px input);
// the frozen Level 0 protocol gates do not require a specific frame rate, and
// most training HOLA samples span only 6 frames. Below ~7 FPS the motion of a
// fast sign is genuinely under-sampled, so that is where we reject.
export const MIN_EFFECTIVE_FPS = 7;
const MAX_ACCEPTED_DURATION_MS = 5500;
const LARGE_FRAME_GAP_MS = 250;
const NORMALIZATION_TOLERANCE = 1e-6;

export class CalibrationService {
  private readonly rootPath = `${RNFS.DocumentDirectoryPath}/calibration/audit`;

  public async countSamples(gloss: string): Promise<number> {
    const directory = this.glossDirectory(gloss);
    if (!(await RNFS.exists(directory))) return 0;
    const entries = await RNFS.readDir(directory);
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).length;
  }

  public async deleteSamples(gloss: string): Promise<void> {
    const directory = this.glossDirectory(gloss);
    if (await RNFS.exists(directory)) {
      await RNFS.unlink(directory);
    }
  }

  public validateSample(
    rawFrames: number[][][],
    normalizedFrames: number[][][],
    timestamps: number[],
    endReason: 'hand_release' | 'max_duration',
    processorTargetFps: number = 24,
  ): CalibrationQuality {
    const reasons: string[] = [];
    const frameCount = rawFrames.length;
    const timestampsValid =
      timestamps.length === frameCount &&
      timestamps.every((value, index) =>
        Number.isFinite(value) && (index === 0 || value > timestamps[index - 1]),
      );
    if (!timestampsValid) reasons.push('invalid_timestamps');

    const durationMs = timestampsValid && frameCount > 1
      ? timestamps[timestamps.length - 1] - timestamps[0]
      : 0;
    const intervals = timestampsValid
      ? timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index])
      : [];
    const effectiveFps = durationMs > 0 ? ((frameCount - 1) * 1000) / durationMs : 0;
    const maxFrameGapMs = intervals.length ? Math.max(...intervals) : 0;
    const targetIntervalMs = 1000 / processorTargetFps;
    const estimatedDroppedFrames = intervals.reduce(
      (total, interval) => total + Math.max(0, Math.round(interval / targetIntervalMs) - 1),
      0,
    );
    if (effectiveFps > 0 && effectiveFps < MIN_EFFECTIVE_FPS) reasons.push('low_fps');
    if (maxFrameGapMs > LARGE_FRAME_GAP_MS) reasons.push('large_frame_gap');

    let shoulderFrames = 0;
    const handPresence: boolean[] = [];
    let finiteFrames = 0;
    for (const frame of rawFrames) {
      if (
        frame.length === 543 &&
        frame.every((landmark) =>
          landmark.length === 3 && landmark.every((coordinate) => Number.isFinite(coordinate)),
        )
      ) finiteFrames += 1;

      if (!isZero(frame[11]) && !isZero(frame[12])) shoulderFrames += 1;
      const handLandmarkCount = frame
        .slice(33, 75)
        .filter((landmark) => !isZero(landmark)).length;
      handPresence.push(handLandmarkCount >= 8);
    }

    if (finiteFrames !== frameCount) reasons.push('invalid_coordinates');
    const activeFrameCount = handPresence.filter(Boolean).length;
    const firstHandFrameIndex = handPresence.indexOf(true);
    const lastHandFrameIndex = handPresence.lastIndexOf(true);
    const activeDurationMs =
      timestampsValid && firstHandFrameIndex >= 0 && lastHandFrameIndex > firstHandFrameIndex
        ? timestamps[lastHandFrameIndex] - timestamps[firstHandFrameIndex]
        : 0;
    const preRollFrameCount = Math.max(0, firstHandFrameIndex);
    const postRollFrameCount = lastHandFrameIndex >= 0
      ? Math.max(0, frameCount - lastHandFrameIndex - 1)
      : 0;
    if (activeFrameCount < 5 || activeDurationMs < 250) reasons.push('too_short');
    if (activeDurationMs > MAX_ACCEPTED_DURATION_MS || endReason === 'max_duration') {
      reasons.push('too_long');
    }
    if (activeFrameCount === 0) reasons.push('missing_hands');
    const shoulderFrameRatio = frameCount ? shoulderFrames / frameCount : 0;
    const handFrameRatio = frameCount ? activeFrameCount / frameCount : 0;
    if (shoulderFrameRatio < 0.8) reasons.push('missing_shoulders');

    let normalizedMaxAbs = 0;
    let normalizationMaxError = 0;
    if (normalizedFrames.length !== frameCount) {
      reasons.push('invalid_normalization');
    } else {
      rawFrames.forEach((rawFrame, frameIndex) => {
        const expected = LandmarkNormalizer.normalizeFrame(rawFrame);
        const actual = normalizedFrames[frameIndex];
        if (!actual || actual.length !== 543) {
          normalizationMaxError = Infinity;
          return;
        }
        actual.forEach((landmark, landmarkIndex) => {
          if (!landmark || landmark.length !== 3) {
            normalizationMaxError = Infinity;
            return;
          }
          landmark.forEach((coordinate, coordinateIndex) => {
            normalizedMaxAbs = Math.max(normalizedMaxAbs, Math.abs(coordinate));
            normalizationMaxError = Math.max(
              normalizationMaxError,
              Math.abs(coordinate - expected[landmarkIndex][coordinateIndex]),
            );
          });
        });
      });
      if (
        !Number.isFinite(normalizationMaxError) ||
        normalizationMaxError > NORMALIZATION_TOLERANCE ||
        normalizedMaxAbs > 1 + NORMALIZATION_TOLERANCE
      ) reasons.push('invalid_normalization');
    }

    const wristTravel = calculateWristTravel(normalizedFrames);

    return {
      valid: reasons.length === 0,
      reasons,
      frameCount,
      durationMs,
      effectiveFps,
      maxFrameGapMs,
      estimatedDroppedFrames,
      shoulderFrameRatio,
      handFrameRatio,
      activeFrameCount,
      activeDurationMs,
      firstHandFrameIndex,
      lastHandFrameIndex,
      preRollFrameCount,
      postRollFrameCount,
      wristTravel,
      normalizedMaxAbs,
      normalizationMaxError,
    };
  }

  public async saveDiagnosticSample(
    gloss: string,
    requestedSpeed: DiagnosticSpeed,
    rawFrames: number[][][],
    normalizedFrames: number[][][],
    timestamps: number[],
    endReason: 'hand_release' | 'max_duration',
    capture: DiagnosticCaptureMetadata,
  ): Promise<string> {
    const quality = this.validateSample(
      rawFrames,
      normalizedFrames,
      timestamps,
      endReason,
      capture.processorTargetFps,
    );
    if (!quality.valid) {
      throw new Error(`Calibration sample failed quality checks: ${quality.reasons.join(', ')}`);
    }

    const directory = this.glossDirectory(gloss);
    await RNFS.mkdir(directory);
    const sampleNumber = (await this.countSamples(gloss)) + 1;
    const createdAt = new Date().toISOString();
    const filename = [
      'Audit01',
      gloss,
      requestedSpeed.toUpperCase(),
      String(sampleNumber).padStart(3, '0'),
      Date.now(),
    ].join('_') + '.json';
    const path = `${directory}/${filename}`;
    const sample: DiagnosticSample = {
      version: 3,
      purpose: 'creator_reference',
      trainingEligible: false,
      gloss,
      requestedSpeed,
      createdAt,
      endReason,
      capture,
      timestamps,
      handPresence: rawFrames.map(hasDetectedHand),
      quality,
      rawFrames,
      normalizedFrames,
    };
    await RNFS.writeFile(path, JSON.stringify(sample), 'utf8');
    return path;
  }

  public getDirectory(gloss: string): string {
    return this.glossDirectory(gloss);
  }

  private glossDirectory(gloss: string): string {
    return `${this.rootPath}/${gloss}`;
  }
}

function isZero(landmark: number[] | undefined): boolean {
  return !landmark || landmark.every((coordinate) => coordinate === 0);
}

function hasDetectedHand(frame: number[][]): boolean {
  return frame.slice(33, 75).filter((landmark) => !isZero(landmark)).length >= 8;
}

function calculateWristTravel(frames: number[][][]): number {
  let travel = 0;
  let previousLeft: number[] | null = null;
  let previousRight: number[] | null = null;
  for (const frame of frames) {
    const left = frame[33];
    const right = frame[54];
    if (previousLeft && !isZero(left)) travel += distance(left, previousLeft);
    if (previousRight && !isZero(right)) travel += distance(right, previousRight);
    previousLeft = !isZero(left) ? left : null;
    previousRight = !isZero(right) ? right : null;
  }
  return travel;
}

function distance(a: number[], b: number[]): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 +
    (a[1] - b[1]) ** 2 +
    (a[2] - b[2]) ** 2,
  );
}
