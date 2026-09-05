import {decodeCompactMotion} from '../CompactSignMotion';

const {compileMotion} = require('../../../tools/compact-sign-motion');
const {motionAssetName} = require('../../../tools/compact-sign-motion');
const {signReleaseSha256} = require('../../../tools/build-published-signs');
const {
  isCurrentPublishedSign,
  reconcileSignVersion,
  requestedGlosses,
  selectSignsForPublication,
} = require('../../../tools/publish-approved-signs');
const {classifyFirebaseState} = require('../../../tools/firebase-sign-status');

describe('compact sign motion', () => {
  it('keeps the authored thumb-to-chin contact for AGUA', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(overrides.AGUA).toEqual(expect.objectContaining({
      rigLeftHandShape: 'thumb-up',
      rigContactLandmark: 4,
      rigContactSnap: 1,
      rigContactUseAvatarAnchor: true,
      rigHeadVerticalOffset: -0.045,
      contactAnchor: 'chin',
    }));
    expect(overrides.AGUA.contactEndFrame).toBeGreaterThan(overrides.AGUA.contactStartFrame);
  });

  it('keeps the authored support hand for AYUDAR', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(overrides.AYUDAR).toEqual(expect.objectContaining({
      forceTwoHands: true,
      rigLeftHandShape: 'thumb-up',
      rigRightHandShape: 'open-palm',
      rigSynchronizedPalmApproach: true,
      rigPalmApproachGain: 3,
      rigPalmApproachVerticalOffset: 0.22,
      rigLeftPalmAxialRollDegrees: -28,
      rigRightHandDepthFlip: false,
      rigRightHandTrackingRepair: 'locked-palm',
    }));
    expect(overrides.AYUDAR.rigInterHandContact).toEqual(expect.objectContaining({
      movingSide: 'L',
      movingLandmarks: [5, 9, 13, 17],
      supportSide: 'R',
      supportLandmarks: [5, 9, 13, 17],
      snap: 1,
    }));
  });

  it('snaps the active fingertip to the rendered cheek for CUÁNDO', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(overrides.CUÁNDO).toEqual(expect.objectContaining({
      rigContactLandmark: 12,
      rigContactSnap: 1,
      rigContactUseAvatarAnchor: true,
      rigContactWindows: [
        {startFrame: 3, endFrame: 6},
        {startFrame: 13, endFrame: 18},
        {startFrame: 28, endFrame: 30},
        {startFrame: 34, endFrame: 35},
      ],
      rigContactFadeFrames: 2,
      contactAnchor: 'cheek',
    }));
  });

  it('keeps AYER behind the head during its authored contact frames', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    const source = require('../../../assets/motions/ayer.motion.json');
    expect(overrides.AYER.rigLeftHandDepthLayer).toBe('back');
    expect(overrides.AYER.rigLeftHandBackDepth).toBeGreaterThan(0);
    expect(source.avatarProfile.activeHand).toBe('left');
    expect(source.avatarProfile.contactEndFrame).toBeGreaterThan(
      source.avatarProfile.contactStartFrame,
    );
  });

  it('keeps BAÑO as one stable open palm without resizing the hand', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(overrides.BAÑO).toEqual(expect.objectContaining({
      rigLeftHandShape: 'flat-palm',
      rigLeftPalmScaleMin: 1,
      rigLeftPalmScaleMax: 1,
    }));
  });

  it('trims BUENAS TARDES and keeps both captured palms fully open', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    const source = require('../../../assets/motions/buenas tardes.motion.json');
    expect(overrides['BUENAS TARDES']).toEqual(expect.objectContaining({
      forceTwoHands: true,
      rigLeftHandShape: 'fully-open',
      rigRightHandShape: 'fully-open',
      rigLeftPalmScaleMin: 1,
      rigLeftPalmScaleMax: 1,
      rigRightPalmScaleMin: 1,
      rigRightPalmScaleMax: 1,
    }));
    expect(source.frames).toHaveLength(30);
    expect(source.avatarProfile.contactStartFrame).toBe(0);
    expect(source.avatarProfile.contactEndFrame).toBe(8);
  });

  it('keeps the recreated BUENOS DÍAS motion continuous and both hands extended', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    const source = require('../../../assets/motions/buenos días.motion.json');
    expect(overrides['BUENOS DÍAS']).toEqual(expect.objectContaining({
      forceTwoHands: true,
      rigLeftHandShape: 'fully-open',
      rigRightHandShape: 'fully-open',
      rigLeftPalmScaleMin: 1,
      rigLeftPalmScaleMax: 1,
      rigRightPalmScaleMin: 1,
      rigRightPalmScaleMax: 1,
      rigLeftHandFrontDepth: 0.46,
      rigRightHandFrontDepth: 0.28,
      rigLeftHandInitialFrontDepth: 0.54,
      rigRightHandInitialFrontDepth: 0.54,
      rigInitialHandFrontDepthEndFrame: 12,
      rigInitialHandFrontDepthFadeFrames: 7,
      rigLeftForearmFollowUpperArmRoll: true,
      rigRightForearmFollowUpperArmRoll: true,
      rigLeftPalmAxialRollDegrees: -90,
      rigPalmAxialRollStartFrame: 20,
      rigPalmAxialRollEndFrame: 26,
      rigPalmAxialRollFadeFrames: 7,
    }));
    expect(overrides['BUENOS DÍAS'].rigHandKeyframes).toBeUndefined();
    expect(overrides['BUENOS DÍAS'].rigRightPalmAxialRollDegrees).toBeUndefined();
    expect(overrides['BUENOS DÍAS'].rigInterHandContact).toEqual({
      movingSide: 'L',
      movingLandmarks: [0, 5, 9, 13, 17],
      supportSide: 'R',
      supportLandmarks: [0, 5, 9, 13, 17],
      snap: 1,
      preserveCapturedOffset: false,
      horizontalOffset: 0.04,
      verticalOffset: 0.12,
      startFrame: 20,
      endFrame: 26,
      fadeInFrames: 7,
      fadeOutFrames: 6,
      maximumCorrection: 0.55,
      allowManualTransforms: true,
    });
    expect(source.frames).toHaveLength(50);
    expect(source.avatarProfile).toEqual(expect.objectContaining({
      contactStartFrame: 7,
      contactEndFrame: 12,
    }));
    expect(
      overrides['BUENOS DÍAS'].rigInterHandContact.startFrame
      - overrides['BUENOS DÍAS'].rigInterHandContact.fadeInFrames,
    ).toBeGreaterThan(source.avatarProfile.contactEndFrame);

    const trajectoryIndexes = [13, 14, 15, 16, 33, 54];
    const speeds = source.frames.slice(1).map((frame: {bodyHands: number[][]}, index: number) => (
      trajectoryIndexes.reduce((total, pointIndex) => {
        const previous = source.frames[index].bodyHands[pointIndex];
        const current = frame.bodyHands[pointIndex];
        return total + Math.hypot(
          current[0] - previous[0],
          current[1] - previous[1],
          (current[2] - previous[2]) * 0.3,
        );
      }, 0) / trajectoryIndexes.length
    ));
    const accelerations = speeds.slice(1).map((speed: number, index: number) => (
      Math.abs(speed - speeds[index])
    ));
    expect(Math.max(...speeds)).toBeLessThan(0.065);
    expect(Math.max(...accelerations)).toBeLessThan(0.02);
  });

  it('keeps the thumb and index extended throughout BLANCO', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    const source = require('../../../assets/motions/blanco.motion.json');
    expect(overrides.BLANCO).toEqual(expect.objectContaining({
      rigLeftHandShape: 'pointing',
      rigLeftFingerStates: {
        thumb: 'extended',
        index: 'extended',
        middle: 'closed',
        ring: 'closed',
        pinky: 'closed',
      },
      rigLeftPalmScaleMin: 1,
      rigLeftPalmScaleMax: 1,
    }));
    expect(source.avatarProfile.activeHand).toBe('left');
  });

  it('keeps BIEN as a compact fist with only its captured thumb exposed', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    const source = require('../../../assets/motions/bien.motion.json');
    expect(overrides.BIEN).toEqual(expect.objectContaining({
      rigLeftHandShape: 'thumb-up',
      rigLeftPalmScaleMin: 1,
      rigLeftPalmScaleMax: 1,
      rigLeftHandDepthScale: 1,
      rigLeftForearmFollowUpperArmRoll: true,
      rigLeftForearmMinimumScreenLength: 0.42,
    }));
    expect(source.avatarProfile.activeHand).toBe('left');
  });

  it('keeps the authored two-hand override for HAMBRE', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(overrides.HAMBRE.forceTwoHands).toBe(true);
    expect(overrides.HAMBRE.rigFistHands).toBe(true);
    expect(overrides.HAMBRE.rigHandFrontDepth).toBeGreaterThan(0);
  });

  it('keeps the index finger stable for personal-pronoun signs', () => {
    const overrides = require('../../../assets/motions/avatar_profile_overrides.json');
    expect(overrides.TÚ.rigPointingHand).toBe(true);
    expect(overrides.YO.rigSelfPointingHand).toBe(true);
  });

  it('reconstructs every landmark within the fixed quantization tolerance', () => {
    const source = {
      fps: 30,
      frames: [
        {bodyHands: [[0.123456, -0.234567, 1.5]], face: [[-1.25, 0, 3.106]]},
        {bodyHands: [[0.987654, 0.456789, -2.75]], face: [[0.25, -0.5, 0.75]]},
      ],
    };

    const encoded: Buffer = compileMotion(source);
    const decoded = decodeCompactMotion(new Uint8Array(encoded));

    expect(decoded.fps).toBe(source.fps);
    expect(decoded.frames).toHaveLength(source.frames.length);
    source.frames.forEach((frame, frameIndex) => {
      [...frame.bodyHands, ...frame.face].forEach((point, pointIndex) => {
        const decodedPoints = [
          ...decoded.frames[frameIndex].bodyHands,
          ...decoded.frames[frameIndex].face,
        ];
        point.forEach((coordinate, coordinateIndex) => {
          expect(Math.abs(decodedPoints[pointIndex][coordinateIndex] - coordinate)).toBeLessThanOrEqual(0.00005);
        });
      });
    });
  });

  it('rejects coordinates that cannot be represented safely', () => {
    expect(() => compileMotion({
      fps: 30,
      frames: [{bodyHands: [[4, 0, 0]], face: [[0, 0, 0]]}],
    })).toThrow('outside the compact range');
  });

  it('uses safe asset filenames without collapsing distinct Spanish accents', () => {
    expect(motionAssetName('EL')).toBe('m_00006500006c');
    expect(motionAssetName('ÉL')).toBe('m_0000e900006c');
    expect(motionAssetName('¿CÓMO ESTÁS?')).toBe('m_0000bf0000630000f300006d00006f0000200000650000730000740000e100007300003f');
  });

  it('changes one sign release when any downloadable content changes', () => {
    const release = {
      sha256: 'motion-a',
      profileSha256: 'profile-a',
      speechAliases: ['buenos días'],
      categories: ['saludos'],
      lexicalClass: 'fixed_expression',
      verbType: 'none',
      requiresSubjectMarker: false,
    };
    const original = signReleaseSha256(release);

    expect(signReleaseSha256({...release, sha256: 'motion-b'})).not.toBe(original);
    expect(signReleaseSha256({...release, profileSha256: 'profile-b'})).not.toBe(original);
    expect(signReleaseSha256({...release, speechAliases: ['buen día']})).not.toBe(original);
    expect(signReleaseSha256({...release, categories: ['tiempo']})).not.toBe(original);
    expect(signReleaseSha256({...release, updatedAt: 'tomorrow'})).toBe(original);
  });

  it('uploads only when an approved sign has a new release or version', () => {
    const release = {
      sha256: 'motion-a',
      profileSha256: 'profile-a',
      speechAliases: ['hola'],
      categories: ['saludos'],
      lexicalClass: 'fixed_expression',
      verbType: 'none',
      requiresSubjectMarker: false,
    };
    const signData = {
      ...release,
      version: 3,
      releaseSha256: signReleaseSha256(release),
    };
    const existing = {
      ...release,
      version: 3,
      published: true,
      approved: true,
      compiled: true,
    };

    expect(isCurrentPublishedSign(existing, signData)).toBe(true);
    expect(isCurrentPublishedSign({...existing, version: 2}, signData)).toBe(false);
    expect(isCurrentPublishedSign({...existing, sha256: 'motion-b'}, signData)).toBe(false);
  });

  it('derives the next sign version from Firebase instead of local build files', () => {
    const release = {
      sha256: 'motion-a',
      profileSha256: 'profile-a',
      speechAliases: ['hola'],
      categories: ['saludos'],
      lexicalClass: 'fixed_expression',
      verbType: 'none',
      requiresSubjectMarker: false,
    };
    const signData = {
      ...release,
      languageId: 'lsc-co',
      assetName: 'm_hola.motion.bin',
      version: 1,
      releaseSha256: signReleaseSha256(release),
    };
    const currentRemote = {
      ...release,
      version: 7,
      releaseSha256: signData.releaseSha256,
    };
    const previousRemote = {
      ...currentRemote,
      sha256: 'old-motion',
      releaseSha256: signReleaseSha256({...release, sha256: 'old-motion'}),
    };

    expect(reconcileSignVersion(currentRemote, signData).version).toBe(7);
    expect(reconcileSignVersion(previousRemote, signData).version).toBe(8);
  });

  it('limits a partial publication to the explicitly selected gloss', () => {
    const glosses = requestedGlosses(['--gloss', 'Buenos días']);
    const signs = [
      {id: 'hola', data: {gloss: 'HOLA'}},
      {id: 'buenos-dias', data: {gloss: 'BUENOS DÍAS'}},
    ];

    expect(glosses).toEqual(['BUENOS DÍAS']);
    expect(selectSignsForPublication(signs, glosses)).toEqual([signs[1]]);
    expect(() => selectSignsForPublication(signs, ['NO EXISTE'])).toThrow(
      'Approved signs not found for publication: NO EXISTE.',
    );
  });

  it('distinguishes current, changed, and unpublished Firebase signs', () => {
    const local = {releaseSha256: 'current-release'};

    expect(classifyFirebaseState(local, undefined)).toBe('not_published');
    expect(classifyFirebaseState(undefined, {releaseSha256: 'remote'})).toBe(
      'published_not_approved',
    );
    expect(classifyFirebaseState(local, {releaseSha256: 'current-release'})).toBe(
      'current',
    );
    expect(classifyFirebaseState(local, {releaseSha256: 'older-release'})).toBe(
      'changes_pending',
    );
  });
});
