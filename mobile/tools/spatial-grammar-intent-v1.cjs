'use strict';

const Ajv2020 = require('ajv/dist/2020').default;
const schema = require('../../schemas/spatial-grammar-intent-v1.schema.json');
const {RigCapabilityError, validateRigCapabilityProfile} = require('./rig-capability-profile.cjs');
const validateSchema = new Ajv2020({allErrors: true, strict: true}).compile(schema);

/** Resolve IDs within an authoring draft only; frame references remain opaque and output is non-executable. */
function compileSpatialGrammarIntent(source, profile) {
  if (!validateSchema(source)) {
    throw new RigCapabilityError('SCHEMA.INVALID_SPATIAL_INTENT', 'Invalid spatial grammar intent', {errors: validateSchema.errors});
  }
  validateRigCapabilityProfile(profile);
  const binding = source.profileBinding;
  if (binding.id !== profile.id || binding.revision !== profile.revision ||
      binding.sha256 !== profile.sha256 || binding.candidateSha256 !== profile.asset.candidateSha256) {
    throw new RigCapabilityError('COMPATIBILITY.SPATIAL_PROFILE_BINDING', 'Spatial intent is not bound to the exact rig profile and candidate', {
      expected: {id: profile.id, revision: profile.revision, sha256: profile.sha256, candidateSha256: profile.asset.candidateSha256},
      actual: binding,
    });
  }
  const frames = new Map(profile.descriptor.coordinateFrames.map(frame => [frame.id, frame]));
  const coordinateFrame = resolveFrame(frames, source.coordinateFrameRef, 'coordinate');
  const ids = new Set();
  const locusIds = new Set();
  const loci = source.loci.map(locus => {
    registerUniqueId(ids, locus.id, 'locus');
    locusIds.add(locus.id);
    if (locus.positionM.some(value => !Number.isFinite(value))) {
      throw new RigCapabilityError('SPATIAL.INVALID_COORDINATE', 'Locus coordinates must be finite meters', {locusId: locus.id});
    }
    return {id: locus.id, positionM: [...locus.positionM]};
  }).sort((a, b) => compareText(a.id, b.id));
  const entities = source.entities.map(entity => {
    registerUniqueId(ids, entity.id, 'entity');
    if (!locusIds.has(entity.locusRef)) {
      throw new RigCapabilityError('SPATIAL.UNKNOWN_LOCUS', 'Entity references an undeclared locus', {
        entityId: entity.id, locusRef: entity.locusRef,
      });
    }
    const objectFrame = resolveFrame(frames, entity.objectFrameRef, 'object');
    return {
      id: entity.id,
      roleRef: entity.roleRef,
      locusRef: entity.locusRef,
      objectFrame: {id: objectFrame.id, definition: objectFrame.definition, status: objectFrame.status},
    };
  }).sort((a, b) => compareText(a.id, b.id));
  return deepFreeze({
    schema: 'vozual.bound-spatial-authoring-trace',
    formatVersion: 1,
    source: {id: source.id, revision: source.revision},
    rigProfile: {id: profile.id, revision: profile.revision, sha256: profile.sha256,
      candidateSha256: profile.asset.candidateSha256, candidateStatus: profile.asset.candidateStatus},
    coordinateFrame: {id: coordinateFrame.id, definition: coordinateFrame.definition, status: coordinateFrame.status},
    execution: 'authoring-only-not-executable',
    loci,
    entities,
  });
}

function resolveFrame(frames, frameId, role) {
  const frame = frames.get(frameId);
  if (!frame) {
    throw new RigCapabilityError('SPATIAL.UNKNOWN_FRAME', `Spatial intent references an undeclared ${role} frame`, {frameId, role});
  }
  return frame;
}

function registerUniqueId(ids, id, kind) {
  if (ids.has(id)) {
    throw new RigCapabilityError('SPATIAL.DUPLICATE_ID', 'Locus and entity IDs must be globally unique', {id, kind});
  }
  ids.add(id);
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

module.exports = {compileSpatialGrammarIntent};
