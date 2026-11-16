import {KinematicHandPose} from './KinematicRigBinding';

export type KinematicExecutionFrame = {
  timeMs: number;
  hands: {left: KinematicHandPose; right: KinematicHandPose};
  nonManual: {
    id: string;
    headRotationDeg: [number, number, number];
    gazeDirection: [number, number, number];
    browRaise: number;
    smile: number;
    mouthOpening: number;
    mouthPucker: number;
  };
};

export type KinematicExecutionPlan = {
  schema: 'vozual.runtime-execution-plan';
  formatVersion: 1;
  source: {id: string; revision: number; sha256: string};
  rig: {profileId: string; profileRevision: number; sha256: string};
  durationMs: number;
  sampleRateHz: number;
  frames: KinematicExecutionFrame[];
};

export function isKinematicExecutionPlan(value: unknown): value is KinematicExecutionPlan {
  if (value === null || typeof value !== 'object') return false;
  const plan = value as Partial<KinematicExecutionPlan>;
  return plan.schema === 'vozual.runtime-execution-plan'
    && plan.formatVersion === 1
    && typeof plan.durationMs === 'number'
    && plan.durationMs > 0
    && Array.isArray(plan.frames)
    && plan.frames.length >= 2;
}
