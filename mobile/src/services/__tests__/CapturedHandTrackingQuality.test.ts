import {
  auditCapturedHandTracking,
  lockPalmHandLandmarkFrames,
  repairStablePalmHandLandmarkFrames,
} from '../CapturedHandTrackingQuality';
import {MotionPoint, SignMotion} from '../CompactSignMotion';

const point = (x: number, y: number, z = 0): MotionPoint => [x, y, z];

function openPalm(offsetX = 0): MotionPoint[] {
  const hand = Array.from({length: 21}, () => point(offsetX, 0));
  hand[0] = point(offsetX, 0);
  hand[1] = point(offsetX - 0.02, 0.02);
  hand[2] = point(offsetX - 0.04, 0.04);
  hand[3] = point(offsetX - 0.06, 0.06);
  hand[4] = point(offsetX - 0.08, 0.08);
  [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]
    .forEach((chain, fingerIndex) => {
      const rootX = offsetX + 0.06 - fingerIndex * 0.04;
      chain.forEach((landmarkIndex, segmentIndex) => {
        hand[landmarkIndex] = point(
          rootX,
          0.04 + fingerIndex * 0.002 + segmentIndex * 0.045,
          fingerIndex * 0.003,
        );
      });
    });
  return hand;
}

describe('captured hand tracking quality', () => {
  it('does not warn about a translated stable palm', () => {
    const hands = [openPalm(0), openPalm(0.01), openPalm(0.02)];

    expect(auditCapturedHandTracking(hands).unstableFrames).toEqual([]);
  });

  it('detects a palm orientation inversion and a collapsed palm', () => {
    const stable = openPalm(0);
    const inverted = openPalm(0.01);
    [inverted[5], inverted[17]] = [inverted[17], inverted[5]];
    const collapsed = openPalm(0.02);
    collapsed[17] = point(collapsed[5][0] + 0.001, collapsed[5][1] + 0.001);
    const hands = [stable, inverted, collapsed, openPalm(0.03)];
    const audit = auditCapturedHandTracking(hands);

    expect(audit.palmOrientationFlipFrames.length).toBeGreaterThan(0);
    expect(audit.palmCollapseFrames).toContain(2);
    expect(audit.unstableFrames).toContain(2);
  });

  it('repairs only failed local shapes while retaining the captured wrist path', () => {
    const hands = [openPalm(0), openPalm(0.01), openPalm(0.02), openPalm(0.03)];
    [hands[1][5], hands[1][17]] = [hands[1][17], hands[1][5]];
    hands[2][17] = point(hands[2][5][0] + 0.001, hands[2][5][1] + 0.001);
    const original = hands.map(hand => hand.map(value => [...value] as MotionPoint));
    const repaired = repairStablePalmHandLandmarkFrames(hands);

    expect(repaired[0]).toEqual(original[0]);
    expect(repaired[3]).toEqual(original[3]);
    expect(repaired[1][0]).toEqual(original[1][0]);
    expect(repaired[2][0]).toEqual(original[2][0]);
    expect(auditCapturedHandTracking(repaired).unstableFrames).toEqual([]);
    expect(hands).toEqual(original);
  });

  it('finds and repairs the captured support-hand failures in AYUDAR', () => {
    const motion = require('../../../assets/motions/ayudar.motion.json') as SignMotion;
    const captured = motion.frames.map(frame => frame.bodyHands.slice(54, 75));
    const audit = auditCapturedHandTracking(captured);
    const repaired = repairStablePalmHandLandmarkFrames(captured);
    const repairedAudit = auditCapturedHandTracking(repaired);

    expect(audit.palmOrientationFlipFrames.length).toBeGreaterThan(0);
    expect(audit.palmCollapseFrames.length).toBeGreaterThan(0);
    expect(repairedAudit.palmOrientationFlipFrames).toEqual([]);
    expect(repairedAudit.palmCollapseFrames).toEqual([]);
    repaired.forEach((hand, frameIndex) => {
      expect(hand[0]).toEqual(captured[frameIndex][0]);
    });
  });

  it('locks an authored support palm while preserving every captured wrist', () => {
    const hands = [openPalm(0.1), openPalm(0.14), openPalm(0.18)];
    [hands[1][5], hands[1][17]] = [hands[1][17], hands[1][5]];
    const original = hands.map(hand => hand.map(value => [...value] as MotionPoint));
    const locked = lockPalmHandLandmarkFrames(hands);

    locked.forEach((hand, frameIndex) => {
      expect(hand[0]).toEqual(original[frameIndex][0]);
      hand.slice(1).forEach((landmark, landmarkIndex) => {
        const reference = original[0][landmarkIndex + 1];
        expect(landmark[0] - hand[0][0]).toBeCloseTo(reference[0] - original[0][0][0]);
        expect(landmark[1] - hand[0][1]).toBeCloseTo(reference[1] - original[0][0][1]);
        expect(landmark[2] - hand[0][2]).toBeCloseTo(reference[2] - original[0][0][2]);
      });
    });
    expect(hands).toEqual(original);
  });
});
