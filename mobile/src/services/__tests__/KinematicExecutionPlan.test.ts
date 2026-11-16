import {isKinematicExecutionPlan} from '../KinematicExecutionPlan';

describe('isKinematicExecutionPlan', () => {
  it('accepts only a non-empty v3 runtime plan', () => {
    expect(isKinematicExecutionPlan({
      schema: 'vozual.runtime-execution-plan', formatVersion: 1, durationMs: 100,
      frames: [{}, {}],
    })).toBe(true);
    expect(isKinematicExecutionPlan({
      schema: 'vozual.runtime-execution-plan', formatVersion: 2, durationMs: 100, frames: [{}, {}],
    })).toBe(false);
    expect(isKinematicExecutionPlan(null)).toBe(false);
  });
});
