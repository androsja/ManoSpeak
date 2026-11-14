'use strict';

const crypto = require('crypto');

class RigCapabilityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function profileSha256(profile) {
  const unsigned = {...profile};
  delete unsigned.sha256;
  return crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
}

function validateRigCapabilityProfile(profile) {
  if (!profile || profile.schema !== 'vozual.rig-capability-profile' || profile.schemaVersion !== 2) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'A v2 rig capability profile is required');
  }
  const actual = profileSha256(profile);
  if (profile.sha256 !== actual) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Rig profile checksum does not match its content', {expected: profile.sha256, actual});
  }
  return profile;
}

function requireRigCapabilities(profile, requiredCapabilities) {
  validateRigCapabilityProfile(profile);
  for (const capability of requiredCapabilities) {
    if (profile.capabilities?.[capability] !== 'structurally_verified') {
      throw new RigCapabilityError(
        'COMPATIBILITY.RIG_PROFILE',
        `Rig ${profile.id}@${profile.revision} does not declare ${capability} as structurally verified`,
        {capability, profileId: profile.id, profileRevision: profile.revision, profileSha256: profile.sha256},
      );
    }
  }
}

function assertReachableTarget(profile, targetDistanceM) {
  validateRigCapabilityProfile(profile);
  if (!Number.isFinite(targetDistanceM) || targetDistanceM < 0) {
    throw new RigCapabilityError('KINEMATIC.UNREACHABLE', 'Target distance must be a finite non-negative measurement');
  }
  const lengths = profile.anthropometricsM;
  const maximumReachM = lengths.leftUpperArmLength + lengths.leftForearmLength + lengths.leftHandLength;
  if (targetDistanceM > maximumReachM) {
    throw new RigCapabilityError(
      'KINEMATIC.UNREACHABLE',
      `Target ${targetDistanceM} m exceeds measured reach ${maximumReachM} m`,
      {targetDistanceM, maximumReachM, profileId: profile.id, profileRevision: profile.revision, profileSha256: profile.sha256},
    );
  }
  return {maximumReachM};
}

module.exports = {RigCapabilityError, assertReachableTarget, profileSha256, requireRigCapabilities, validateRigCapabilityProfile};
