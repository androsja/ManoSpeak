import {chooseFrontCartoonHand} from '../CartoonHandLayering';
import {CartoonHandPoint} from '../CartoonHandGeometry';

function hand(scale = 1, z = 0): CartoonHandPoint[] {
  const points = Array.from({length: 21}, () => [0.1, 0.1, z] as CartoonHandPoint);
  points[0] = [0.1, 0.1, z];
  points[9] = [0.1, 0.1 + scale, z];
  points[12] = [0.1, 0.1 + scale * 2, z];
  return points;
}

describe('cartoon hand layering', () => {
  it('draws a clearly nearer hand in front using captured depth', () => {
    expect(chooseFrontCartoonHand(hand(1, -0.2), hand(1, 0.1), 54)).toBe(33);
  });

  it('uses apparent hand scale when depth is inconclusive', () => {
    expect(chooseFrontCartoonHand(hand(1.4), hand(1), 54)).toBe(33);
  });

  it('keeps the previous order in the ambiguity band to avoid flickering', () => {
    expect(chooseFrontCartoonHand(hand(1), hand(1.05), 33)).toBe(33);
  });

  it('puts the available hand in front when its counterpart is missing', () => {
    expect(chooseFrontCartoonHand(hand(), Array.from({length: 21}, () => [0, 0, 0] as CartoonHandPoint), 54)).toBe(33);
  });
});
