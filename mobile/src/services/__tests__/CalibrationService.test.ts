jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  exists: jest.fn(),
  readDir: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  unlink: jest.fn(),
}));

import RNFS from 'react-native-fs';
import { CalibrationService, DiagnosticCaptureMetadata } from '../CalibrationService';
import { LandmarkNormalizer } from '../LandmarkNormalizer';

const captureMetadata: DiagnosticCaptureMetadata = {
  platform: 'android',
  cameraPosition: 'front',
  cameraDeviceId: 'front-camera',
  rotationDegrees: 270,
  horizontallyMirrored: true,
  previewVisible: false,
  mediaPipeTasksVersion: '0.10.20',
  processorTargetFps: 24,
  timestampClock: 'monotonic_performance_ms',
  landmarkLayout: 'pose33_left21_right21_face468',
  normalizer: 'shoulder_center_scale_clip_v1',
  purpose: 'creator_reference',
  consent: {
    version: 'creator_capture_consent_v1',
    acceptedAt: '2026-08-09T00:00:00.000Z',
    scope: 'avatar_animation_reference',
    localOnly: true,
    trainingEligible: false,
  },
};

describe('CalibrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    (RNFS.readDir as jest.Mock).mockResolvedValue([]);
    (RNFS.mkdir as jest.Mock).mockResolvedValue(undefined);
    (RNFS.writeFile as jest.Mock).mockResolvedValue(undefined);
    (RNFS.unlink as jest.Mock).mockResolvedValue(undefined);
  });

  test('counts only JSON sample files', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    (RNFS.readDir as jest.Mock).mockResolvedValue([
      { name: 'User01_HOLA_001.json', isFile: () => true },
      { name: 'notes.txt', isFile: () => true },
      { name: 'nested', isFile: () => false },
    ]);

    await expect(new CalibrationService().countSamples('HOLA')).resolves.toBe(1);
  });

  test('saves a labeled variable-length sample with timing and quality metadata', async () => {
    const rawFrames = makeValidFrames(12);
    const normalizedFrames = rawFrames.map((frame) => LandmarkNormalizer.normalizeFrame(frame));
    const timestamps = Array.from({ length: 12 }, (_, index) => 1000 + index * 50);

    const path = await new CalibrationService().saveDiagnosticSample(
      'HOLA',
      'natural',
      rawFrames,
      normalizedFrames,
      timestamps,
      'hand_release',
      captureMetadata,
    );

    expect(path).toContain('/documents/calibration/audit/HOLA/Audit01_HOLA_NATURAL_001_');
    expect(RNFS.mkdir).toHaveBeenCalledWith('/documents/calibration/audit/HOLA');
    const [, payload, encoding] = (RNFS.writeFile as jest.Mock).mock.calls[0];
    expect(encoding).toBe('utf8');
    expect(JSON.parse(payload)).toMatchObject({
      version: 3,
      purpose: 'creator_reference',
      trainingEligible: false,
      gloss: 'HOLA',
      requestedSpeed: 'natural',
      endReason: 'hand_release',
      capture: {
        horizontallyMirrored: true,
        timestampClock: 'monotonic_performance_ms',
        purpose: 'creator_reference',
        consent: {
          version: 'creator_capture_consent_v1',
          scope: 'avatar_animation_reference',
          localOnly: true,
          trainingEligible: false,
        },
      },
      quality: {
        valid: true,
        frameCount: 12,
        activeFrameCount: 12,
        activeDurationMs: 550,
        firstHandFrameIndex: 0,
        lastHandFrameIndex: 11,
        preRollFrameCount: 0,
        postRollFrameCount: 0,
        effectiveFps: 20,
        estimatedDroppedFrames: 0,
        normalizationMaxError: 0,
      },
    });
    expect(JSON.parse(payload).rawFrames).toHaveLength(12);
    expect(JSON.parse(payload).normalizedFrames).toHaveLength(12);
    expect(JSON.parse(payload).handPresence).toEqual(Array(12).fill(true));
    expect(JSON.parse(payload).frames).toBeUndefined();
  });

  test('records pre-roll and post-roll around the active hand interval', () => {
    const rawFrames = makeValidFrames(12);
    for (const frameIndex of [0, 1, 10, 11]) {
      for (let index = 33; index < 75; index++) rawFrames[frameIndex][index] = [0, 0, 0];
    }
    const normalizedFrames = rawFrames.map((frame) => LandmarkNormalizer.normalizeFrame(frame));
    const quality = new CalibrationService().validateSample(
      rawFrames,
      normalizedFrames,
      Array.from({ length: 12 }, (_, index) => 1000 + index * 50),
      'hand_release',
      24,
    );

    expect(quality).toMatchObject({
      valid: true,
      activeFrameCount: 8,
      activeDurationMs: 350,
      firstHandFrameIndex: 2,
      lastHandFrameIndex: 9,
      preRollFrameCount: 2,
      postRollFrameCount: 2,
    });
  });

  test('rejects a sample that is too short', async () => {
    const rawFrames = makeValidFrames(2);
    const normalizedFrames = rawFrames.map((frame) => LandmarkNormalizer.normalizeFrame(frame));
    await expect(
      new CalibrationService().saveDiagnosticSample(
        'HOLA',
        'fast',
        rawFrames,
        normalizedFrames,
        [1000, 1050],
        'hand_release',
        captureMetadata,
      ),
    ).rejects.toThrow(
      'Calibration sample failed quality checks: too_short',
    );
    expect(RNFS.writeFile).not.toHaveBeenCalled();
  });

  test('rejects low frame rate and reports estimated dropped frames', () => {
    const rawFrames = makeValidFrames(6);
    const normalizedFrames = rawFrames.map((frame) => LandmarkNormalizer.normalizeFrame(frame));
    const quality = new CalibrationService().validateSample(
      rawFrames,
      normalizedFrames,
      [0, 200, 400, 600, 800, 1000],
      'hand_release',
      24,
    );

    expect(quality.valid).toBe(false);
    expect(quality.reasons).toContain('low_fps');
    expect(quality.estimatedDroppedFrames).toBeGreaterThan(0);
    expect(quality.maxFrameGapMs).toBe(200);
  });

  test('deletes the private diagnostic directory when resetting', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);

    await new CalibrationService().deleteSamples('HOLA');

    expect(RNFS.unlink).toHaveBeenCalledWith('/documents/calibration/audit/HOLA');
  });
});

function makeValidFrames(count: number): number[][][] {
  return Array.from({ length: count }, (_, frameIndex) => {
    const frame = Array.from({ length: 543 }, () => [0, 0, 0]);
    frame[11] = [0.4, 0.5, 0];
    frame[12] = [0.6, 0.5, 0];
    for (let index = 33; index < 54; index++) {
      frame[index] = [0.4 + frameIndex * 0.002, 0.3, 0];
    }
    return frame;
  });
}
