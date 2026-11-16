'use strict';

const crypto = require('crypto');
const {canonicalJson, profileSha256, RigCapabilityError, validateRigCapabilityProfile} = require('./rig-capability-profile.cjs');
const isolatedCatalog = require('../../schemas/rig-profiles/vozual-rig-1.isolated-probes.v2.json');

const EVIDENCED_PROFILE_SHA = '7651784cc5aa3b3f48fcbc0176e8ef50dd4728fabe73ef181c9662907f4324a0';
const EVIDENCED_CANDIDATE_SHA = '748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a';
const EVIDENCED_REST_AXES_INVENTORY_SHA = 'e576d44fb13360d2fbff89ba455d2d89b6141c4c3f8f297b24e592818097abbf';
const EVIDENCED_ISOLATED_CATALOG_SHA = 'f1f7c176ed26f2387e7a48c647880720b840c7adea3c14905349462e2f6ef70a';

function mechanicalEvidenceBasisSha(profile) {
  const basis = {...profile, descriptor: {...profile.descriptor}};
  delete basis.descriptor.visualFidelityEvidence;
  return profileSha256(basis);
}

function assertIsolatedCatalog(profile) {
  const restAxesInventory = profile.descriptor.boneInventory.restAxesInventory;
  if (mechanicalEvidenceBasisSha(profile) !== EVIDENCED_PROFILE_SHA || profile.asset.candidateSha256 !== EVIDENCED_CANDIDATE_SHA) {
    throw new RigCapabilityError('COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY', 'Isolated diagnostic catalog is unavailable for this profile');
  }
  const {sha256, ...unsigned} = isolatedCatalog;
  const actual = crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
  if (actual !== sha256 || sha256 !== EVIDENCED_ISOLATED_CATALOG_SHA ||
      isolatedCatalog.schema !== 'vozual.rig-isolated-probe-catalog' || isolatedCatalog.schemaVersion !== 2 ||
      isolatedCatalog.profileSha256 !== mechanicalEvidenceBasisSha(profile) ||
      isolatedCatalog.candidateSha256 !== profile.asset.candidateSha256 ||
      isolatedCatalog.candidateSha256 !== restAxesInventory.candidateSha256 ||
      restAxesInventory.sha256 !== EVIDENCED_REST_AXES_INVENTORY_SHA ||
      isolatedCatalog.restAxesInventorySha256 !== restAxesInventory.sha256) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Isolated diagnostic catalog checksum or binding mismatch');
  }
}

function correctedHandConfiguration(side) {
  const suffix = side === 'left' ? 'L' : 'R';
  const commands = {};
  for (const digit of ['f_index', 'f_middle', 'f_ring', 'f_pinky', 'thumb']) {
    for (const [index, flexion] of [0.15, 0.2, 0.15].entries()) {
      let z = 0;
      if (index === 0 && (digit === 'f_middle' || digit === 'f_ring')) {
        z = 0.025 * (digit === 'f_middle' ? 1 : -1) * (side === 'left' ? 1 : -1);
      }
      if (index === 0 && digit === 'thumb') z = side === 'left' ? 0.2 : -0.1;
      commands[`DEF-${digit}.0${index + 1}.${suffix}`] = [flexion, 0, z];
    }
  }
  return {id: `corrected-hand-diagnostic-${side}-v1`, rotationCommandsRad: commands};
}

function validateIsolatedDiagnostic(profile, commands) {
  assertIsolatedCatalog(profile);
  if (!commands || typeof commands !== 'object' || Array.isArray(commands) || Object.keys(commands).length !== 1) {
    throw new RigCapabilityError('COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY', 'An isolated probe requires exactly one bone');
  }
  const [bone] = Object.keys(commands);
  const vector = commands[bone];
  if (!Object.hasOwn(profile.descriptor.boneInventory.restAxesInventory.bones, bone) ||
      !Object.hasOwn(isolatedCatalog.bones, bone) || !Array.isArray(vector) || vector.length !== 3 ||
      vector.some(value => !Number.isFinite(value)) || vector.filter(value => value !== 0).length !== 1) {
    throw new RigCapabilityError('COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY', 'An isolated probe requires one declared bone and one nonzero axis');
  }
  const index = vector.findIndex(value => value !== 0);
  const axis = ['x', 'y', 'z'][index];
  const sample = isolatedCatalog.bones[bone][axis]?.find(item => item[0] === vector[index]);
  if (!sample) {
    throw new RigCapabilityError('COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY', 'The exact isolated angle was not measured',
      {bone, axis, angleRadians: vector[index]});
  }
  if (sample[1] !== 0) {
    throw new RigCapabilityError('KINEMATIC.DIAGNOSTIC_COLLISION', 'The isolated sample has measured scoped overlaps',
      {bone, axis, angleRadians: vector[index], overlapCount: sample[1], candidateSha256: profile.asset.candidateSha256});
  }
}

/** Discrete diagnostic configurations; no interpolation or anatomical limits. */
function mechanicalConformanceContract(profile) {
  validateRigCapabilityProfile(profile);
  const endpoint = profile.descriptor.coordinateCalibration.endpointConformancePose;
  const corrected = mechanicalEvidenceBasisSha(profile) === EVIDENCED_PROFILE_SHA && profile.asset.candidateSha256 === EVIDENCED_CANDIDATE_SHA
    ? ['left', 'right'].map(correctedHandConfiguration) : [];
  if (corrected.length) assertIsolatedCatalog(profile);
  for (const configuration of corrected) {
    for (const bone of Object.keys(configuration.rotationCommandsRad)) {
      if (!Object.hasOwn(profile.descriptor.boneInventory.restAxesInventory.bones, bone)) {
        throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', `Diagnostic bone is not declared: ${bone}`);
      }
    }
  }
  const contract = {
    schema: 'vozual.rig-mechanical-conformance',
    schemaVersion: 1,
    profileSha256: profile.sha256,
    candidateSha256: profile.asset.candidateSha256,
    mechanicalObservationManifestSha256: profile.descriptor.mechanicalObservationEvidence.manifestSha256,
    representation: 'rest-relative-local-euler-XYZ-radians',
    initialization: 'reset-every-bone-to-profile-rest-before-each-probe',
    domain: 'discrete-configurations-only',
    anatomicalLimits: 'unsupported',
    configurations: [
      {id: 'neutral-rest', rotationCommandsRad: {}},
      {
        id: endpoint.id,
        rotationCommandsRad: Object.fromEntries(Object.entries(endpoint.rotationCommandsRad)
          .map(([bone, angle]) => [bone, [angle, 0, 0]])),
      },
      ...corrected,
    ],
  };
  if (corrected.length) contract.isolatedDiagnosticCatalogSha256 = isolatedCatalog.sha256;
  return contract;
}

function validateMechanicalConformanceProbes(profile, probes) {
  if (!Array.isArray(probes) || !probes.length) {
    throw new RigCapabilityError('SCHEMA.UNSUPPORTED_VERSION', 'Mechanical probes must be a nonempty array');
  }
  const contract = mechanicalConformanceContract(profile);
  const poseIds = probes.map(probe => {
    if (!probe || typeof probe !== 'object' || Array.isArray(probe) ||
        Object.keys(probe).sort().join(',') !== 'poseId,rotationCommandsRad') {
      throw new RigCapabilityError('SCHEMA.UNSUPPORTED_VERSION', 'Mechanical probes require only poseId and rotationCommandsRad');
    }
    if (probe.poseId === 'isolated-bone-probe-v1') {
      validateIsolatedDiagnostic(profile, probe.rotationCommandsRad);
      return probe.poseId;
    }
    const supported = contract.configurations.find(pose => pose.id === probe.poseId);
    if (!supported || canonicalJson(probe.rotationCommandsRad) !== canonicalJson(supported.rotationCommandsRad)) {
      throw new RigCapabilityError('COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
        'Mechanical configuration is outside the discrete conformance domain',
        {requiredCapability: 'rig.mechanicalConfiguration', poseId: probe.poseId,
          profileSha256: profile.sha256, candidateSha256: profile.asset.candidateSha256});
    }
    return probe.poseId;
  });
  return {
    contractSha256: crypto.createHash('sha256').update(canonicalJson(contract)).digest('hex'),
    poseIds,
    disposition: 'diagnostic-only-no-motion-emitted',
  };
}

module.exports = {mechanicalConformanceContract, validateMechanicalConformanceProbes};
