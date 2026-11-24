import fs from 'fs';
import path from 'path';
import {
  armMotionScore,
  AvatarArmBinding,
  bindHandsToArms,
  bindingsForMotion,
} from '../src/services/AvatarMotionBinding';
import {
  capturedFaceCalibration,
  capturedFacePresentation,
  type CapturedFacePresentation,
} from '../src/services/AvatarMotionPresentation';
import {MotionPoint, SignMotion} from '../src/services/CompactSignMotion';
import {parseJsonMotionDocument} from '../src/services/JsonMotionLoader';
import {
  auditCapturedHandTracking,
  CapturedHandTrackingAudit,
  RiggedHandTrackingRepair,
} from '../src/services/CapturedHandTrackingQuality';
import {LegacyMotionDocument, parseLegacyMotionDocument} from '../src/services/LegacyMotionLoader';

type AvatarProfile = {
  activeHand?: 'left' | 'right';
  contactAnchor?: 'chin' | 'forehead' | 'mouth';
  contactStartFrame?: number;
  contactEndFrame?: number;
  forceTwoHands?: boolean;
  rigFistHands?: boolean;
  rigPointingHand?: boolean;
  rigSelfPointingHand?: boolean;
  rigSoftHandCurl?: boolean;
  rigStableOpenHand?: boolean;
  rigLeftHandTrackingRepair?: RiggedHandTrackingRepair;
  rigRightHandTrackingRepair?: RiggedHandTrackingRepair;
};

type ArmAudit = {
  arm: 'pose-0' | 'pose-1';
  handStart?: number;
  coverage: number;
  bindingAgreement: number;
  motionScore: number;
  accelerationP95: number;
  maximumPhalanxVariation: number;
};

type SignAudit = {
  gloss: string;
  frames: number;
  fps: number;
  durationSeconds: number;
  dimensions: {bodyHands: number; face: number};
  profile: AvatarProfile;
  arms: ArmAudit[];
  predictedOneHanded: boolean;
  faceMotion: number;
  face: FaceAudit;
  handTracking: Array<{
    handStart: 33 | 54;
    audit: CapturedHandTrackingAudit;
  }>;
  handTrackingStatus: 'CLEAN' | 'REVIEW' | 'HIGH';
  findings: string[];
  status: 'PASS' | 'REVIEW' | 'ERROR';
  semantic?: SignMotion['semantic'];
};

type FaceAudit = {
  coverage: number;
  finiteAndBounded: boolean;
  peakHeadTurn: number;
  peakEyeExpression: number;
  peakMouthExpression: number;
  peakBrowExpression: number;
};

const ROOT = path.resolve(__dirname, '..');
const MOTION_DIRECTORY = path.join(ROOT, 'assets', 'motions');
const OUTPUT_DIRECTORY = path.join(ROOT, 'build', 'reports');
const HAND_SEGMENTS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];
const FACE_FEATURES = [10, 13, 14, 33, 61, 70, 105, 107, 145, 152, 159, 263, 291, 300, 334, 336, 374, 386];

function isValid(point: MotionPoint | undefined): point is MotionPoint {
  return point != null && point.some(value => Math.abs(value) > 1e-8);
}

function distance(first: MotionPoint, second: MotionPoint): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function quantile(values: number[], position: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function median(values: number[]): number {
  return quantile(values, 0.5);
}

function shoulderScale(motion: SignMotion): number {
  const widths = motion.frames.flatMap(frame => {
    const first = frame.bodyHands[11];
    const second = frame.bodyHands[12];
    return isValid(first) && isValid(second) ? [distance(first, second)] : [];
  });
  return Math.max(0.001, median(widths));
}

function handCoverage(motion: SignMotion, handStart?: number): number {
  if (handStart === undefined) return 0;
  const validFrames = motion.frames.filter(frame => isValid(frame.bodyHands[handStart])).length;
  return validFrames / motion.frames.length;
}

function bindingAgreement(
  motion: SignMotion,
  armIndex: number,
  stable: AvatarArmBinding,
): number {
  if (stable.handStart === undefined) return 1;
  const observed = motion.frames.flatMap(frame => {
    const current = bindHandsToArms(frame)[armIndex].handStart;
    return current === undefined ? [] : [current];
  });
  if (observed.length === 0) return 1;
  return observed.filter(handStart => handStart === stable.handStart).length / observed.length;
}

function normalizedAccelerationP95(
  motion: SignMotion,
  binding: AvatarArmBinding,
  scale: number,
): number {
  const indexes = [binding.elbow, binding.wrist];
  if (binding.handStart !== undefined) {
    indexes.push(...[4, 8, 12, 16, 20].map(index => binding.handStart! + index));
  }
  const accelerations: number[] = [];
  indexes.forEach(index => {
    for (let frameIndex = 2; frameIndex < motion.frames.length; frameIndex += 1) {
      const first = motion.frames[frameIndex - 2].bodyHands[index];
      const second = motion.frames[frameIndex - 1].bodyHands[index];
      const third = motion.frames[frameIndex].bodyHands[index];
      if (!isValid(first) || !isValid(second) || !isValid(third)) continue;
      accelerations.push(Math.hypot(
        third[0] - 2 * second[0] + first[0],
        third[1] - 2 * second[1] + first[1],
        third[2] - 2 * second[2] + first[2],
      ) / scale);
    }
  });
  return quantile(accelerations, 0.95);
}

function maximumPhalanxVariation(motion: SignMotion, handStart?: number): number {
  if (handStart === undefined) return 0;
  return Math.max(0, ...HAND_SEGMENTS.map(([from, to]) => {
    const lengths = motion.frames.flatMap(frame => {
      const start = frame.bodyHands[handStart + from];
      const end = frame.bodyHands[handStart + to];
      return isValid(start) && isValid(end) ? [distance(start, end)] : [];
    });
    const center = median(lengths);
    if (center < 1e-8) return 0;
    const absoluteDeviations = lengths.map(length => Math.abs(length - center));
    return median(absoluteDeviations) / center;
  }));
}

function normalizedFaceMotion(motion: SignMotion, scale: number): number {
  const changes: number[] = [];
  FACE_FEATURES.forEach(index => {
    for (let frameIndex = 1; frameIndex < motion.frames.length; frameIndex += 1) {
      const previous = motion.frames[frameIndex - 1].face[index];
      const current = motion.frames[frameIndex].face[index];
      if (isValid(previous) && isValid(current)) changes.push(distance(previous, current) / scale);
    }
  });
  return median(changes);
}

function maximumOf(
  presentations: CapturedFacePresentation[],
  select: (presentation: CapturedFacePresentation) => number[],
): number {
  return Math.max(0, ...presentations.flatMap(select).map(Math.abs));
}

function auditFace(motion: SignMotion): FaceAudit {
  const calibration = capturedFaceCalibration(motion);
  const reference = motion.frames.find(frame => (
    capturedFacePresentation(frame.face, frame.face, calibration) != null
  ))?.face;
  const presentations = reference
    ? motion.frames.flatMap(frame => {
      const presentation = capturedFacePresentation(frame.face, reference, calibration);
      return presentation ? [presentation] : [];
    })
    : [];
  const unitKeys: Array<keyof CapturedFacePresentation> = [
    'leftEyeClosure', 'rightEyeClosure',
    'leftEyeWidening', 'rightEyeWidening',
    'mouthOpening', 'mouthPucker',
    'leftMouthCornerDrop', 'rightMouthCornerDrop',
    'leftMouthCornerRaise', 'rightMouthCornerRaise',
    'leftInnerBrowLift', 'rightInnerBrowLift',
    'leftInnerBrowLower', 'rightInnerBrowLower',
  ];
  const finiteAndBounded = presentations.every(presentation => (
    Object.values(presentation).every(Number.isFinite)
    && unitKeys.every(key => presentation[key] >= 0 && presentation[key] <= 1)
    && Math.abs(presentation.headYaw) <= 0.8
    && Math.abs(presentation.headPitch) <= 0.55
    && Math.abs(presentation.headRoll) <= 0.7
  ));
  return {
    coverage: presentations.length / Math.max(1, motion.frames.length),
    finiteAndBounded,
    peakHeadTurn: maximumOf(presentations, value => [
      value.headYaw, value.headPitch, value.headRoll,
    ]),
    peakEyeExpression: maximumOf(presentations, value => [
      value.leftEyeClosure, value.rightEyeClosure,
      value.leftEyeWidening, value.rightEyeWidening,
    ]),
    peakMouthExpression: maximumOf(presentations, value => [
      value.mouthOpening, value.mouthPucker,
      value.leftMouthCornerDrop, value.rightMouthCornerDrop,
      value.leftMouthCornerRaise, value.rightMouthCornerRaise,
    ]),
    peakBrowExpression: maximumOf(presentations, value => [
      value.leftInnerBrowLift, value.rightInnerBrowLift,
      value.leftInnerBrowLower, value.rightInnerBrowLower,
    ]),
  };
}

function validateMotion(motion: SignMotion): string[] {
  const findings: string[] = [];
  if (!Number.isFinite(motion.fps) || motion.fps <= 0) findings.push('invalid FPS');
  if (!Array.isArray(motion.frames) || motion.frames.length < 2) findings.push('fewer than two frames');
  if (motion.frames.length === 0) return findings;
  const bodyCount = motion.frames[0].bodyHands.length;
  const faceCount = motion.frames[0].face.length;
  if (bodyCount < 75) findings.push(`only ${bodyCount} body/hand landmarks`);
  if (faceCount < 468) findings.push(`only ${faceCount} face landmarks`);
  motion.frames.forEach((frame, frameIndex) => {
    if (frame.bodyHands.length !== bodyCount || frame.face.length !== faceCount) {
      findings.push(`landmark dimensions change at frame ${frameIndex}`);
    }
    if ([...frame.bodyHands, ...frame.face].some(point => (
      !Array.isArray(point) || point.length !== 3 || point.some(value => !Number.isFinite(value))
    ))) {
      findings.push(`malformed coordinate at frame ${frameIndex}`);
    }
  });
  return [...new Set(findings)];
}

function mergedProfile(
  motion: SignMotion & {avatarProfile?: AvatarProfile},
  override: AvatarProfile | undefined,
): AvatarProfile {
  return {...(motion.avatarProfile ?? {}), ...(override ?? {})};
}

function auditSign(
  gloss: string,
  motion: SignMotion & {avatarProfile?: AvatarProfile},
  profileOverride?: AvatarProfile,
): SignAudit {
  const findings = validateMotion(motion);
  const scale = shoulderScale(motion);
  const bindings = bindingsForMotion(motion);
  const profile = mergedProfile(motion, profileOverride);
  const face = auditFace(motion);
  const handTracking = ([33, 54] as const).map(handStart => ({
    handStart,
    audit: auditCapturedHandTracking(motion.frames.map(frame => (
      frame.bodyHands.slice(handStart, handStart + 21)
    ))),
  }));
  const armsAudited: ArmAudit[] = bindings.map((binding, armIndex) => ({
    arm: armIndex === 0 ? 'pose-0' : 'pose-1',
    handStart: binding.handStart,
    coverage: handCoverage(motion, binding.handStart),
    bindingAgreement: bindingAgreement(motion, armIndex, binding),
    motionScore: armMotionScore(motion, armIndex, bindings),
    accelerationP95: normalizedAccelerationP95(motion, binding, scale),
    maximumPhalanxVariation: maximumPhalanxVariation(motion, binding.handStart),
  }));
  const motionScores = armsAudited.map(arm => arm.motionScore);
  const activeScore = Math.max(...motionScores);
  const passiveScore = Math.min(...motionScores);
  const predictedOneHanded = !profile.forceTwoHands
    && bindings.some(binding => binding.handStart === undefined)
    && activeScore > 0.01
    && activeScore >= passiveScore * 1.8;

  armsAudited.forEach(arm => {
    if (arm.handStart !== undefined && arm.coverage < 0.7) {
      findings.push(`${arm.arm} hand coverage is only ${(arm.coverage * 100).toFixed(0)}%`);
    }
    if (arm.bindingAgreement < 0.8) {
      findings.push(`${arm.arm} hand label changes during the sign`);
    }
    if (arm.accelerationP95 > 0.22) {
      findings.push(`${arm.arm} contains high-frequency landmark movement`);
    }
    if (arm.maximumPhalanxVariation > 0.18) {
      findings.push(`${arm.arm} has unstable captured phalanx lengths`);
    }
  });
  handTracking.forEach(({handStart, audit}) => {
    const label = handStart === 33 ? 'hand block 33' : 'hand block 54';
    if (audit.palmCollapseFrames.length > 0) {
      findings.push(
        `${label} palm collapses at frames ${audit.palmCollapseFrames.join(', ')}`,
      );
    }
    if (audit.palmOrientationFlipFrames.length > 0) {
      findings.push(
        `${label} reverses palm orientation at frames ${audit.palmOrientationFlipFrames.join(', ')}`,
      );
    }
    if (audit.phalanxOutlierFrames.length > 0) {
      findings.push(
        `${label} has finger-length outliers at frames ${audit.phalanxOutlierFrames.join(', ')}`,
      );
    }
  });
  if (profile.forceTwoHands && bindings.some(binding => binding.handStart === undefined)) {
    findings.push('two-handed profile is missing a captured hand block');
  }
  if (profile.contactAnchor && (
    profile.contactStartFrame === undefined || profile.contactEndFrame === undefined
  )) {
    findings.push('contact anchor has no complete frame window');
  }
  if (face.coverage < 0.95) {
    findings.push(`facial control coverage is only ${(face.coverage * 100).toFixed(0)}%`);
  }
  if (!face.finiteAndBounded) {
    findings.push('facial controls contain invalid or unbounded values');
  }

  const structuralError = findings.some(finding => (
    finding.includes('invalid')
    || finding.includes('malformed')
    || finding.includes('dimensions change')
    || finding.includes('fewer than')
    || finding.includes('only 7')
    || finding.includes('only 4')
  ));
  const trackingCounts = handTracking.reduce(
    (totals, item) => ({
      flips: totals.flips + item.audit.palmOrientationFlipFrames.length,
      collapses: totals.collapses + item.audit.palmCollapseFrames.length,
      phalanxes: totals.phalanxes + item.audit.phalanxOutlierFrames.length,
    }),
    {flips: 0, collapses: 0, phalanxes: 0},
  );
  const trackingTotal = trackingCounts.flips
    + trackingCounts.collapses
    + trackingCounts.phalanxes;
  const handTrackingStatus = trackingCounts.flips >= 2
    || trackingCounts.collapses >= 3
    || trackingCounts.phalanxes >= 5
    || trackingTotal >= 8
    ? 'HIGH'
    : trackingTotal > 0
      ? 'REVIEW'
      : 'CLEAN';
  return {
    gloss,
    frames: motion.frames.length,
    fps: motion.fps,
    durationSeconds: motion.frames.length / motion.fps,
    dimensions: {
      bodyHands: motion.frames[0]?.bodyHands.length ?? 0,
      face: motion.frames[0]?.face.length ?? 0,
    },
    profile,
    arms: armsAudited,
    predictedOneHanded,
    faceMotion: normalizedFaceMotion(motion, scale),
    face,
    handTracking,
    handTrackingStatus,
    findings,
    status: structuralError ? 'ERROR' : findings.length > 0 ? 'REVIEW' : 'PASS',
    semantic: motion.semantic,
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function markdownReport(audits: SignAudit[]): string {
  const pass = audits.filter(audit => audit.status === 'PASS').length;
  const review = audits.filter(audit => audit.status === 'REVIEW').length;
  const error = audits.filter(audit => audit.status === 'ERROR').length;
  const trackingClean = audits.filter(audit => audit.handTrackingStatus === 'CLEAN').length;
  const trackingReview = audits.filter(audit => audit.handTrackingStatus === 'REVIEW').length;
  const trackingHigh = audits.filter(audit => audit.handTrackingStatus === 'HIGH').length;
  const lines = [
    '# VOZUAL avatar sign audit',
    '',
    `Generated from the ${audits.length} published motion files. This is a deterministic structural and motion-quality pre-audit; final linguistic and visual approval still requires comparing PUNTOS against PERSONAJE on a device.`,
    '',
    `Summary: ${pass} pass, ${review} require visual review, ${error} structural errors.`,
    `Hand-tracking priority: ${trackingClean} clean, ${trackingReview} targeted review, ${trackingHigh} high priority.`,
    '',
    '| Sign | Status | Tracking | Frames | Binding | Motion L/R | Hand tracking 33/54 | Face H/E/M/B | Main finding |',
    '| --- | --- | --- | ---: | --- | --- | --- | --- | --- |',
  ];
  audits.forEach(audit => {
    const binding = audit.arms.map(arm => (
      arm.handStart === undefined
        ? '-'
        : `${arm.handStart}:${formatPercent(arm.bindingAgreement)}`
    )).join(' / ');
    const movement = audit.arms.map(arm => arm.motionScore.toFixed(3)).join(' / ');
    const faceChannels = [
      audit.face.peakHeadTurn,
      audit.face.peakEyeExpression,
      audit.face.peakMouthExpression,
      audit.face.peakBrowExpression,
    ].map(value => value.toFixed(2)).join(' / ');
    const handTracking = audit.handTracking.map(({audit: handAudit}) => (
      `${handAudit.palmOrientationFlipFrames.length}F/${handAudit.palmCollapseFrames.length}C/${handAudit.phalanxOutlierFrames.length}P`
    )).join(' / ');
    lines.push(
      `| ${audit.gloss} | ${audit.status} | ${audit.handTrackingStatus} | ${audit.frames} | ${binding} | ${movement} | ${handTracking} | ${faceChannels} | ${audit.findings[0] ?? 'No automatic warning'} |`,
    );
  });
  lines.push(
    '',
    '## Interpretation',
    '',
    '- PASS means the stored landmarks are structurally consistent; it does not replace LSC review.',
    '- REVIEW means the device comparison must focus on label stability, capture jitter, phalanx proportions, or an authored profile.',
    '- Face H/E/M/B reports peak captured head, eye, mouth, and brow controls after per-clip calibration.',
    '- Hand tracking F/C/P reports palm-orientation reversals, palm collapses, and phalanx outliers. These flags form a visual-review queue; an intentional palm turn is not automatically changed.',
    '- PUNTOS remains the source of truth. Renderer-only corrections must never overwrite these motion files.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(
    path.join(MOTION_DIRECTORY, 'published_signs.json'),
    'utf8',
  )) as {publishedGlosses?: string[]};
  const linguisticCatalog = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'assets', 'data', 'lsc_linguistic_catalog.json'),
    'utf8',
  )) as {entries?: Array<{
    gloss?: string;
    motion?: {clip?: string};
    spanish?: {lemmas?: string[]; synonyms?: string[]; forms?: Array<{text?: string}>};
  }>} ;
  const overridesPath = path.join(MOTION_DIRECTORY, 'avatar_profile_overrides.json');
  const overrides = fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) as Record<string, AvatarProfile>
    : {};
  const glosses = catalog.publishedGlosses ?? [];
  const audits = glosses.map(gloss => {
    const entry = linguisticCatalog.entries?.find(candidate => (
      candidate.motion?.clip?.toLocaleUpperCase('es-CO') === gloss.toLocaleUpperCase('es-CO')
    ));
    const sourceNames = [
      gloss,
      entry?.gloss,
      ...(entry?.spanish?.lemmas ?? []),
      ...(entry?.spanish?.forms ?? []).map(form => form.text),
    ].filter((name): name is string => Boolean(name?.trim()));
    const sourcePaths = sourceNames.map(name => path.join(
      MOTION_DIRECTORY,
      `${name.toLocaleLowerCase('es-CO')}.motion.json`,
    ));
    sourcePaths.push(...sourceNames.map(name => path.join(
      MOTION_DIRECTORY,
      `${name.toLocaleLowerCase('es-CO')}.motion.v3.json`,
    )));
    const motionPath = sourcePaths.find(candidate => fs.existsSync(candidate));
    if (!motionPath) throw new Error(`${gloss} has no editable JSON motion source.`);
    const source = JSON.parse(fs.readFileSync(motionPath, 'utf8')) as {
      semantic?: {schema?: string};
    };
    const motion = source.semantic?.schema === 'vozual.number-motion-draft'
      ? parseJsonMotionDocument(source, motionPath)
      : parseLegacyMotionDocument(source, motionPath);
    return auditSign(gloss, motion, overrides[gloss.toUpperCase()]);
  });

  fs.mkdirSync(OUTPUT_DIRECTORY, {recursive: true});
  const jsonPath = path.join(OUTPUT_DIRECTORY, 'avatar-sign-audit.json');
  const markdownPath = path.join(OUTPUT_DIRECTORY, 'avatar-sign-audit.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify({generatedAt: new Date().toISOString(), audits}, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdownReport(audits));
  const pass = audits.filter(audit => audit.status === 'PASS').length;
  const review = audits.filter(audit => audit.status === 'REVIEW').length;
  const error = audits.filter(audit => audit.status === 'ERROR').length;
  const trackingReview = audits.filter(audit => audit.handTrackingStatus === 'REVIEW').length;
  const trackingHigh = audits.filter(audit => audit.handTrackingStatus === 'HIGH').length;
  console.log(`Audited ${audits.length} published signs: ${pass} pass, ${review} review, ${error} errors.`);
  console.log(`Hand tracking: ${trackingHigh} high priority, ${trackingReview} targeted review, ${audits.length - trackingHigh - trackingReview} clean.`);
  console.log(`Detailed reports: ${jsonPath} and ${markdownPath}`);
  if (error > 0) process.exitCode = 1;
}

main();
