'use strict';

const {
  RigCapabilityError,
  requireRigCapabilities,
  verifyCandidateAsset,
} = require('./rig-capability-profile.cjs');

function rejectUnreviewedCapabilityRequests(requiredCapabilities, profile) {
  if (!Array.isArray(requiredCapabilities)) return;
  for (const capability of requiredCapabilities) {
    if (typeof capability === 'string' &&
        (capability.startsWith('anatomical.') || capability === 'manual.thumbJoints' ||
         capability.startsWith('manual.thumb.') || capability.startsWith('sign.') || capability.startsWith('linguistic.sign.'))) {
      throw new RigCapabilityError(
        'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
        `Rig ${profile?.id || 'unknown'}@${profile?.revision || 'unknown'} has no reviewed hash-bound admission for ${capability}`,
        {capability, profileId: profile?.id, profileRevision: profile?.revision, profileSha256: profile?.sha256},
      );
    }
  }
}

/** Prepare the immutable rig identity that a v4 compiler must bind to its output. */
function bindRigForV4Compilation(profile, candidateBytes, requiredCapabilities, mechanicalObservation) {
  rejectUnreviewedCapabilityRequests(requiredCapabilities, profile);
  verifyCandidateAsset(profile, candidateBytes);
  requireRigCapabilities(profile, requiredCapabilities);
  const inventorySha256 = profile.descriptor.boneInventory.restAxesInventory.sha256;
  if (!mechanicalObservation || mechanicalObservation.manifestSha256 !== profile.descriptor.mechanicalObservationEvidence.manifestSha256 ||
      mechanicalObservation.reportProjectionSha256 !== profile.descriptor.mechanicalObservationEvidence.reportProjectionSha256 ||
      mechanicalObservation.candidateSha256 !== profile.asset.candidateSha256 ||
      mechanicalObservation.restAxesInventorySha256 !== inventorySha256 ||
      !/^[a-f0-9]{64}$/.test(mechanicalObservation.reportRawSha256 || '')) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Validated mechanical observation digests do not match the profile, candidate, and rest-axis inventory');
  }
  return Object.freeze({
    profileId: profile.id,
    profileRevision: profile.revision,
    profileSha256: profile.sha256,
    candidateSha256: profile.asset.candidateSha256,
    restAxesInventorySha256: inventorySha256,
    mechanicalObservationManifestSha256: profile.descriptor.mechanicalObservationEvidence.manifestSha256,
    mechanicalObservationReportProjectionSha256: profile.descriptor.mechanicalObservationEvidence.reportProjectionSha256,
    mechanicalObservationReportRawSha256: mechanicalObservation.reportRawSha256,
    requiredCapabilities: [...new Set(requiredCapabilities)].sort(),
    candidateStatus: profile.asset.candidateStatus,
  });
}

/** Reject an artifact whose serialized rig identity differs from its compile input. */
function assertV4CompiledRigBinding(artifact, binding) {
  const rig = artifact?.rig;
  if (!rig || typeof rig !== 'object' || Array.isArray(rig)) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Compiled v4 artifact must include a rig binding');
  }
  const matches = rig.profileId === binding.profileId
    && rig.profileRevision === binding.profileRevision
    && rig.profileSha256 === binding.profileSha256
    && rig.candidateSha256 === binding.candidateSha256
    && rig.restAxesInventorySha256 === binding.restAxesInventorySha256
    && /^[a-f0-9]{64}$/.test(rig.restAxesInventorySha256 || '')
    && rig.mechanicalObservationManifestSha256 === binding.mechanicalObservationManifestSha256
    && /^[a-f0-9]{64}$/.test(rig.mechanicalObservationManifestSha256 || '')
    && rig.mechanicalObservationReportProjectionSha256 === binding.mechanicalObservationReportProjectionSha256
    && /^[a-f0-9]{64}$/.test(rig.mechanicalObservationReportProjectionSha256 || '')
    && rig.mechanicalObservationReportRawSha256 === binding.mechanicalObservationReportRawSha256
    && /^[a-f0-9]{64}$/.test(rig.mechanicalObservationReportRawSha256 || '')
    && Array.isArray(rig.requiredCapabilities)
    && JSON.stringify([...rig.requiredCapabilities].sort()) === JSON.stringify(binding.requiredCapabilities);
  const observation = artifact?.conformanceDiagnostics?.mechanicalObservation;
  const observationMatches = observation?.manifestSha256 === binding.mechanicalObservationManifestSha256 &&
    observation.reportProjectionSha256 === binding.mechanicalObservationReportProjectionSha256 &&
    observation.reportRawSha256 === binding.mechanicalObservationReportRawSha256 &&
    observation.candidateSha256 === binding.candidateSha256 &&
    observation.restAxesInventorySha256 === binding.restAxesInventorySha256 &&
    /^[a-f0-9]{64}$/.test(observation.reportRawSha256 || '') &&
    observation.claim === 'observed-mechanical-response-only' &&
    observation.disposition === 'provenance-only-no-executable-authorization' &&
    observation.boneCount === 171 && observation.signedAxisSampleCount === 1026 &&
    observation.samplesWithWeightedDisplacement === 1026;
  if (!matches || !observationMatches) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Compiled v4 artifact rig binding does not match the validated compile inputs');
  }
  return artifact;
}

module.exports = {assertV4CompiledRigBinding, bindRigForV4Compilation, rejectUnreviewedCapabilityRequests};
