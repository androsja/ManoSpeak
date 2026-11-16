'use strict';

/**
 * The authoring compiler is intentionally separate from this module.  It can
 * be used to preview a draft.  This module is the fail-closed boundary which
 * produces immutable inputs for a release publisher (Task 19).
 */
const crypto = require('crypto');
const Ajv2020 = require('ajv/dist/2020').default;
const v2Schema = require('../../schemas/motion-schema-v2.schema.json');
const {canonicalJson, validateKinematicMotionV3} = require('./kinematic-motion-v3.cjs');
const {compileKinematicMotionV3} = require('./compile-kinematic-motion-v3.cjs');

const PUBLISHABLE_COMPILER_VERSION = '3.0.0';
const EXECUTION_PLAN_FORMAT_VERSION = 1;
const MOTION_BINARY_FORMAT_VERSION = 3;
const PUBLISHABLE_SAMPLE_RATE_HZ = 120;

// v2 predates AJV's strictTypes rule (its conditional subschema omits an
// explicit object type). Keep validation strict for data while preserving that
// immutable legacy contract.
const validateV2Structure = new Ajv2020({allErrors: true, strict: false, validateFormats: false}).compile(v2Schema);

class PublishableCompilationError extends Error {
  constructor(code, path, message, report) {
    super(`${path}: ${message}`);
    this.name = 'PublishableCompilationError';
    this.code = code;
    this.path = path;
    this.report = report;
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function bytesArtifact(kind, formatVersion, bytes) {
  return Object.freeze({kind, formatVersion, bytes, sha256: sha256(bytes), sizeBytes: bytes.byteLength});
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function issue(stage, code, path, message) {
  return Object.freeze({stage, code, path, message});
}

function reportFor(document, profile, stages, observations) {
  return {
    schema: 'vozual.compilation-report',
    formatVersion: 1,
    compilerVersion: PUBLISHABLE_COMPILER_VERSION,
    source: {
      id: typeof document?.id === 'string' ? document.id : null,
      revision: Number.isInteger(document?.revision) ? document.revision : null,
      schemaVersion: Number.isInteger(document?.schemaVersion) ? document.schemaVersion : null,
      sha256: document && typeof document === 'object' ? sha256(canonicalJson(document)) : null,
    },
    rig: profile ? {profileId: profile.id, profileRevision: profile.revision, sha256: profile.sha256} : null,
    sampleRateHz: PUBLISHABLE_SAMPLE_RATE_HZ,
    stages,
    observations,
  };
}

function throwIssue(document, profile, stages, observations, current) {
  const report = reportFor(document, profile, [...stages, {name: current.stage, status: 'failed', issues: [current]}], observations);
  throw new PublishableCompilationError(current.code, current.path, current.message, report);
}

function registeredRigAdapter(profile) {
  if (!profile || profile.schema !== 'vozual.rig-profile' || profile.schemaVersion !== 1) return null;
  // A future rig-specific solver must opt into geometric constraint evaluation.
  // Keeping this explicit prevents a generic compiler from fabricating fingertip
  // positions, surface normals, or body-anchor geometry.
  if (profile.id === 'vozual-rig-1' && profile.revision === 1) {
    return Object.freeze({
      adapterId: 'vozual-rig-1-adapter',
      adapterVersion: 1,
      profileId: profile.id,
      profileRevision: profile.revision,
      canEvaluateGeometricConstraints: false,
    });
  }
  return null;
}

function requireApprovedLinguisticReview(document) {
  const review = document.linguisticReview;
  if (!review || review.status !== 'approved' || review.language !== 'lsc-CO'
      || typeof review.reviewerId !== 'string' || review.reviewerId.trim() === ''
      || !validDate(review.reviewedAt)) {
    return issue('semantic', 'SEMANTIC.LINGUISTIC_REVIEW', '$.linguisticReview', 'approved, dated LSC linguistic review is required for publication');
  }
  if (!document.linguisticIntent?.glossSequence?.length || document.linguisticIntent.language !== 'lsc-CO') {
    return issue('semantic', 'SEMANTIC.LINGUISTIC_INTENT', '$.linguisticIntent', 'a non-empty LSC linguistic intent is required');
  }
  if (!validDate(document.provenance?.createdAt) || !validDate(document.provenance?.updatedAt)
      || Date.parse(document.provenance.updatedAt) < Date.parse(document.provenance.createdAt)) {
    return issue('semantic', 'SEMANTIC.PROVENANCE', '$.provenance', 'dated, non-decreasing provenance is required');
  }
  return null;
}

function requireEvaluableConstraints(document, adapter) {
  const realization = document.kinematicRealization;
  const geometric = ['contacts', 'proximities', 'relativePoses', 'trajectories'];
  const required = geometric.flatMap(name => realization[name]
    .filter(record => record.strength === 'required')
    .map(record => `${name}:${record.id}`));
  if (required.length > 0 && !adapter.canEvaluateGeometricConstraints) {
    return issue('kinematic', 'KINEMATIC.UNSUPPORTED_REQUIRED_CONSTRAINT', '$.kinematicRealization',
      `registered rig adapter cannot evaluate required geometric constraints (${required.join(', ')})`);
  }
  return null;
}

function observationsFor(plan) {
  let maxWristSpeedMps = 0;
  let maxJointAbsDeg = 0;
  for (let index = 1; index < plan.frames.length; index += 1) {
    const previous = plan.frames[index - 1];
    const current = plan.frames[index];
    const seconds = (current.timeMs - previous.timeMs) / 1000;
    for (const side of ['left', 'right']) {
      const a = previous.hands[side].wrist.positionM;
      const b = current.hands[side].wrist.positionM;
      maxWristSpeedMps = Math.max(maxWristSpeedMps, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / seconds);
      for (const finger of Object.values(current.hands[side].joints)) {
        for (const joint of Object.values(finger)) {
          for (const value of Object.values(joint)) maxJointAbsDeg = Math.max(maxJointAbsDeg, Math.abs(value));
        }
      }
    }
  }
  return Object.freeze({
    frameCount: plan.frames.length,
    durationMs: plan.durationMs,
    maxWristSpeedMps,
    maxJointAbsDeg,
    requiredGeometricConstraintCount: plan.constraints.requiredContactIds.length + plan.constraints.requiredProximityIds.length,
    requiredJointRelationCount: plan.constraints.requiredJointRelationIds.length,
  });
}

function jointMetricValue(frame, metric) {
  const match = /^hand\.(left|right)\.(thumb|index|middle|ring|pinky)\.(cmc|mcp|ip|pip|dip)\.(flexionDeg|abductionDeg|twistDeg)$/.exec(metric);
  if (!match) return undefined;
  const [, side, finger, joint, axis] = match;
  return frame.hands[side].joints[finger][joint][axis];
}

function evaluateRequiredJointRelations(document, plan) {
  for (const relation of document.kinematicRealization.jointRelations) {
    if (relation.strength !== 'required') continue;
    if (relation.relation === 'within' && (!Number.isFinite(relation.toleranceDeg) || relation.toleranceDeg < 0)) {
      return issue('kinematic-constraints', 'KINEMATIC.JOINT_RELATION_TOLERANCE', '$.kinematicRealization.jointRelations', `required within relation ${relation.id} needs toleranceDeg`);
    }
    for (const frame of plan.frames.filter(value => value.timeMs >= relation.fromMs && value.timeMs <= relation.toMs)) {
      const lhs = jointMetricValue(frame, relation.lhs);
      const rhs = typeof relation.rhs === 'number' ? relation.rhs : jointMetricValue(frame, relation.rhs);
      if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) {
        return issue('kinematic-constraints', 'KINEMATIC.JOINT_RELATION_METRIC', '$.kinematicRealization.jointRelations', `relation ${relation.id} cannot resolve a declared joint metric`);
      }
      const tolerance = relation.toleranceDeg ?? 0;
      const valid = relation.relation === 'eq' ? Math.abs(lhs - rhs) <= tolerance
        : relation.relation === 'lte' ? lhs <= rhs + tolerance
          : relation.relation === 'gte' ? lhs + tolerance >= rhs
            : Math.abs(lhs - rhs) <= tolerance;
      if (!valid) {
        return issue('kinematic-constraints', 'KINEMATIC.JOINT_RELATION_VIOLATION', '$.kinematicRealization.jointRelations', `required relation ${relation.id} fails at ${frame.timeMs}ms`);
      }
    }
  }
  return null;
}

function encodeMotionBinary(plan) {
  const payload = Buffer.from(canonicalJson(plan), 'utf8');
  const header = Buffer.alloc(12);
  header.write('VZKP', 0, 'ascii');
  header.writeUInt8(MOTION_BINARY_FORMAT_VERSION, 4);
  header.writeUInt8(0, 5);
  header.writeUInt16LE(EXECUTION_PLAN_FORMAT_VERSION, 6);
  header.writeUInt32LE(payload.byteLength, 8);
  return Buffer.concat([header, payload]);
}

function validateV3(document, profile) {
  const stages = [];
  const observations = {};
  try {
    validateKinematicMotionV3(document, profile);
    stages.push({name: 'structural-and-anatomical', status: 'passed', issues: []});
  } catch (error) {
    throwIssue(document, profile, stages, observations, issue('structural-and-anatomical', error.code || 'KINEMATIC.INVALID', error.path || '$', error.message));
  }
  const adapter = registeredRigAdapter(profile);
  if (!adapter || document.rig.jointMapRevision !== adapter.adapterVersion) {
    throwIssue(document, profile, stages, observations, issue('compatibility', 'COMPATIBILITY.RIG_ADAPTER', '$.rig', 'no exact, version-compatible rig adapter is registered'));
  }
  stages.push({name: 'compatibility', status: 'passed', issues: []});
  const semanticIssue = requireApprovedLinguisticReview(document);
  if (semanticIssue) throwIssue(document, profile, stages, observations, semanticIssue);
  stages.push({name: 'semantic', status: 'passed', issues: []});
  const constraintIssue = requireEvaluableConstraints(document, adapter);
  if (constraintIssue) throwIssue(document, profile, stages, observations, constraintIssue);

  const compilation = compileKinematicMotionV3(document, profile, {sampleRateHz: PUBLISHABLE_SAMPLE_RATE_HZ});
  const measured = observationsFor(compilation.plan);
  const jointRelationIssue = evaluateRequiredJointRelations(document, compilation.plan);
  if (jointRelationIssue) throwIssue(document, profile, stages, measured, jointRelationIssue);
  const lowestDeclaredSpeed = Math.min(...document.kinematicRealization.transitions.map(value => value.maxSpeedMps));
  if (measured.maxWristSpeedMps > lowestDeclaredSpeed + 1e-9) {
    throwIssue(document, profile, stages, measured, issue('kinematic-constraints', 'KINEMATIC.WRIST_SPEED', '$.kinematicRealization.transitions', `observed wrist speed ${measured.maxWristSpeedMps} exceeds declared limit ${lowestDeclaredSpeed}`));
  }
  Object.assign(observations, measured);
  stages.push({name: 'kinematic-constraints', status: 'passed', issues: []});
  stages.push({name: 'compile', status: 'passed', issues: []});
  return {compilation, stages, observations};
}

function selectCompilerForRecipe(document) {
  if (!document || typeof document !== 'object') return null;
  if (document.schema === 'vozual.motion-schema' && document.schemaVersion === 3 && document.kind === 'authored-kinematic-motion') return 'v3';
  if (document.schema === 'vozual.motion-schema' && document.schemaVersion === 2 && document.kind === 'authored-motion') return 'v2';
  return null;
}

function compilePublishableRecipe(document, profile) {
  const strategy = selectCompilerForRecipe(document);
  if (strategy === 'v2') {
    const stages = [];
    if (!validateV2Structure(document)) {
      const first = validateV2Structure.errors?.[0];
      throwIssue(document, profile, stages, {}, issue('structural', 'STRUCTURE.V2', first?.instancePath || '$', first?.message || 'invalid v2 recipe'));
    }
    throwIssue(document, profile, [{name: 'structural', status: 'passed', issues: []}], {}, issue('compatibility', 'COMPILER.V2_UNSUPPORTED', '$.schemaVersion', 'v2 has no registered deterministic source-to-runtime compiler; publish it through the legacy migration path'));
  }
  if (strategy !== 'v3') {
    throwIssue(document, profile, [], {}, issue('structural', 'STRUCTURE.UNSUPPORTED_SCHEMA', '$.schemaVersion', 'only registered v2 or v3 motion schemas are accepted'));
  }
  const {compilation, stages, observations} = validateV3(document, profile);
  const planBytes = Buffer.from(canonicalJson(compilation.plan), 'utf8');
  const planArtifact = bytesArtifact('execution-plan', EXECUTION_PLAN_FORMAT_VERSION, planBytes);
  const binaryArtifact = bytesArtifact('motion-binary', MOTION_BINARY_FORMAT_VERSION, encodeMotionBinary(compilation.plan));
  const report = reportFor(document, profile, stages, observations);
  const reportArtifact = bytesArtifact('validation-report', 1, Buffer.from(canonicalJson(report), 'utf8'));
  return Object.freeze({
    compilerVersion: PUBLISHABLE_COMPILER_VERSION,
    compatibility: Object.freeze({sourceMotionSchemaVersion: 3, rig: Object.freeze({profileId: profile.id, profileRevision: profile.revision, sha256: profile.sha256})}),
    executionPlan: compilation.plan,
    report,
    artifacts: Object.freeze({executionPlan: planArtifact, motionBinary: binaryArtifact, validationReport: reportArtifact}),
  });
}

module.exports = {
  EXECUTION_PLAN_FORMAT_VERSION,
  MOTION_BINARY_FORMAT_VERSION,
  PUBLISHABLE_COMPILER_VERSION,
  PUBLISHABLE_SAMPLE_RATE_HZ,
  PublishableCompilationError,
  compilePublishableRecipe,
  encodeMotionBinary,
  registeredRigAdapter,
  selectCompilerForRecipe,
};
