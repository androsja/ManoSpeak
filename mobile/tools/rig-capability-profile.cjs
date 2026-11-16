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

function restAxesInventorySha256(inventory) {
  const unsigned = {...inventory};
  delete unsigned.sha256;
  return crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
}

function isFiniteVector(value, length) {
  return Array.isArray(value) && value.length === length && value.every(component => Number.isFinite(component));
}

function validateCoordinateCalibration(descriptor) {
  const calibration = descriptor.coordinateCalibration;
  if (!calibration || calibration.status !== 'measured-rest-pose' ||
      !/^[a-f0-9]{64}$/.test(calibration.measurementSha256 || '') ||
      typeof calibration.measurementArtifact !== 'string' || !calibration.measurementArtifact ||
      calibration.coordinateSystem !== 'gltf-right-handed-y-up' ||
      !Number.isInteger(calibration.anchorCount) || calibration.anchorCount < 1) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Measured coordinate calibration metadata is required');
  }
  const calibratedFrames = ['body', 'torso', 'head'];
  for (const id of calibratedFrames) {
    const frame = calibration[id];
    if (!frame || !isFiniteVector(frame.originM, 3) || !frame.axes ||
        !isFiniteVector(frame.axes.x, 3) || !isFiniteVector(frame.axes.y, 3) || !isFiniteVector(frame.axes.z, 3)) {
      throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', `Invalid measured ${id} frame`);
    }
  }
  for (const side of ['left', 'right']) {
    const hand = calibration.hand?.[side];
    if (!hand || !isFiniteVector(hand.originM, 3) || !hand.axes ||
        !isFiniteVector(hand.axes.x, 3) || !isFiniteVector(hand.axes.y, 3) || !isFiniteVector(hand.axes.z, 3)) {
      throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', `Invalid measured ${side} hand frame`);
    }
  }
  const pose = calibration.endpointConformancePose;
  if (!pose || typeof pose.id !== 'string' || !pose.id || typeof pose.anchorId !== 'string' || !pose.anchorId ||
      !pose.rotationCommandsRad || typeof pose.rotationCommandsRad !== 'object' || !Object.keys(pose.rotationCommandsRad).length ||
      Object.values(pose.rotationCommandsRad).some(value => !Number.isFinite(value)) ||
      !isFiniteVector(pose.targetBodyPositionM, 3) || !isFiniteVector(pose.targetBodyOrientationQuat, 4) ||
      !Number.isFinite(pose.positionToleranceM) || pose.positionToleranceM <= 0 ||
      !Number.isFinite(pose.orientationToleranceDeg) || pose.orientationToleranceDeg <= 0) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Measured endpoint conformance pose is incomplete');
  }
}

function validateBoneRestAxesInventory(profile) {
  const inventory = profile.descriptor.boneInventory;
  if (inventory.localAxes === 'unsupported') {
    if (inventory.restAxesInventory !== undefined) {
      throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Unsupported local axes cannot carry a measured rest-basis inventory');
    }
    return;
  }

  const measured = inventory.restAxesInventory;
  if (!measured || measured.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(measured.sha256 || '') ||
      !/^[a-f0-9]{64}$/.test(measured.sourceArchiveSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(measured.sourceBlendSha256 || '') ||
      measured.candidateSha256 !== profile.asset.candidateSha256 ||
      measured.coordinateSystem !== inventory.axisConvention ||
      measured.axisSemantics !== 'geometric-rest-basis-not-anatomical-joint-axis' ||
      !measured.bones || typeof measured.bones !== 'object' || Array.isArray(measured.bones)) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Measured local axes require a complete candidate-bound rest-basis inventory');
  }
  const actualInventorySha = restAxesInventorySha256(measured);
  const entries = Object.entries(measured.bones);
  if (actualInventorySha !== measured.sha256 || entries.length !== inventory.count) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Rest-basis inventory checksum or bone count is invalid');
  }
  for (const [boneId, bone] of entries) {
    const axes = bone?.axes;
    const basis = axes && ['x', 'y', 'z'].map(axis => axes[axis]);
    if (!boneId || !(bone.parent === null || typeof bone.parent === 'string') ||
        !Number.isFinite(bone.lengthM) || bone.lengthM <= 0 ||
        !basis || basis.some(axis => !isFiniteVector(axis, 3))) {
      throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', `Malformed rest basis for ${boneId || 'unknown bone'}`);
    }
    const [x, y, z] = basis;
    const dot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
    const normErrors = basis.map(axis => Math.abs(Math.sqrt(dot(axis, axis)) - 1));
    const orthogonalityErrors = [Math.abs(dot(x, y)), Math.abs(dot(x, z)), Math.abs(dot(y, z))];
    const crossYZ = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
    const determinant = dot(x, crossYZ);
    if (Math.max(...normErrors, ...orthogonalityErrors) > 1e-5 || determinant < 0.99999) {
      throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', `Rest basis for ${boneId} is not orthonormal and right-handed`);
    }
  }
}

function validateMechanicalObservationEvidenceReference(profile) {
  const {descriptor} = profile;
  const reference = descriptor.mechanicalObservationEvidence;
  const requiredForLineage = profile.id === 'vozual-rig-1' && profile.revision >= 8;
  if (!reference && !requiredForLineage) return;
  const inventorySha = descriptor.boneInventory.restAxesInventory?.sha256;
  if (!reference || reference.schema !== 'vozual.task3-14.mechanical-observation-evidence-manifest' ||
      reference.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/.test(reference.manifestSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(reference.reportProjectionSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(reference.candidateSha256 || '') ||
      !/^[a-f0-9]{64}$/.test(reference.restAxesInventorySha256 || '') ||
      reference.claim !== 'observed-mechanical-response-only' || reference.executableCapability !== false ||
      reference.candidateSha256 !== profile.asset.candidateSha256 ||
      reference.restAxesInventorySha256 !== inventorySha) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Mechanical observation evidence reference is missing, malformed, or bound to different rig inputs');
  }
  if (descriptor.degreesOfFreedom.status !== 'unsupported' || descriptor.jointLimits.status !== 'unsupported') {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Observed mechanical responses cannot declare anatomical degrees of freedom or joint limits');
  }
}

function validateRigCapabilityProfile(profile) {
  if (!profile || profile.schema !== 'vozual.rig-capability-profile' || profile.schemaVersion !== 2) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'A v2 rig capability profile is required');
  }
  const actual = profileSha256(profile);
  if (profile.sha256 !== actual) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Rig profile checksum does not match its content', {expected: profile.sha256, actual});
  }
  if (typeof profile.id !== 'string' || !profile.id || !Number.isInteger(profile.revision) || profile.revision < 1 ||
      !profile.capabilities || !profile.deformChains || !profile.asset || !profile.conformance || !profile.descriptor) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Rig identity and capability descriptor are required');
  }
  const descriptor = profile.descriptor;
  const requiredFrames = ['body', 'torso', 'head', 'bone', 'hand', 'object', 'locus', 'free-signing-space'];
  const frameIds = Array.isArray(descriptor.coordinateFrames)
    ? descriptor.coordinateFrames.map(frame => frame?.id)
    : [];
  if (requiredFrames.some(id => !frameIds.includes(id)) || new Set(frameIds).size !== frameIds.length ||
      descriptor.coordinateFrames.some(frame => typeof frame.definition !== 'string' || !frame.definition ||
        !['declared-unvalidated', 'validated'].includes(frame.status)) ||
      !Number.isInteger(descriptor.boneInventory?.count) || descriptor.boneInventory.count < 1 ||
      typeof descriptor.boneInventory.axisConvention !== 'string' || !descriptor.boneInventory.axisConvention ||
      !['measured', 'unsupported'].includes(descriptor.boneInventory.localAxes) ||
      !['measured', 'unsupported'].includes(descriptor.degreesOfFreedom?.status) ||
      !['measured', 'unsupported'].includes(descriptor.endpointGeometry?.status) ||
      !['measured', 'unsupported'].includes(descriptor.morphTargets?.status) ||
      !['measured', 'unsupported'].includes(descriptor.jointLimits?.status) ||
      !['measured', 'unsupported'].includes(descriptor.constraintFamilies?.status)) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Rig descriptor must declare all frames and explicitly classify axes, degrees of freedom, endpoints, morphs, limits, and constraint families');
  }
  if (!Array.isArray(descriptor.anchors?.ids) || !descriptor.anchors.ids.length ||
      typeof descriptor.anchors.status !== 'string' ||
      !Array.isArray(descriptor.endpointGeometry.anchors) ||
      !Array.isArray(descriptor.morphTargets.ids) ||
      !descriptor.jointLimits.valuesDeg || typeof descriptor.jointLimits.valuesDeg !== 'object' ||
      !Array.isArray(descriptor.constraintFamilies.supported) ||
      !descriptor.skinning ||
      !['measured-limited-pose-set', 'unsupported'].includes(descriptor.skinning.status)) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Rig descriptor sections have malformed inventory fields');
  }
  if (descriptor.anchors.status === 'measured-rest-pose-points' || descriptor.endpointGeometry.status === 'measured') {
    validateCoordinateCalibration(descriptor);
  }
  validateBoneRestAxesInventory(profile);
  validateMechanicalObservationEvidenceReference(profile);
  if (descriptor.skinning.status === 'measured-limited-pose-set' &&
      (!Number.isSafeInteger(descriptor.skinning.maxBoneMatrixErrorNanometers) || descriptor.skinning.maxBoneMatrixErrorNanometers < 0 ||
       !Number.isFinite(descriptor.skinning.maxObservedSurfaceDeviationM) || descriptor.skinning.maxObservedSurfaceDeviationM < 0 ||
       !Number.isFinite(descriptor.skinning.surfaceToleranceM) || descriptor.skinning.surfaceToleranceM <= 0 ||
       descriptor.skinning.maxObservedSurfaceDeviationM > descriptor.skinning.surfaceToleranceM ||
       !descriptor.skinning.testedPoseBoneRadians || typeof descriptor.skinning.testedPoseBoneRadians !== 'object' ||
       !Object.keys(descriptor.skinning.testedPoseBoneRadians).length ||
       Object.values(descriptor.skinning.testedPoseBoneRadians).some(value => !Number.isFinite(value)) ||
       !['passed', 'unsupported'].includes(descriptor.skinning.selfIntersection))) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Measured skinning evidence is incomplete or exceeds its declared tolerance');
  }
  if (!/^[a-f0-9]{64}$/.test(profile.asset.candidateSha256 || '') || profile.asset.candidateStatus !== 'temporary-uncertified') {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'An explicitly identified candidate asset is required');
  }
  for (const key of ['shoulderWidth', 'torsoReferenceHeight', 'leftUpperArmLength', 'leftForearmLength', 'leftHandLength', 'rightUpperArmLength', 'rightForearmLength', 'rightHandLength']) {
    if (!Number.isFinite(profile.anthropometricsM?.[key]) || profile.anthropometricsM[key] <= 0) {
      throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', `Missing or invalid measurement: ${key}`);
    }
  }
  for (const side of ['left', 'right']) {
    const chain = profile.deformChains[side];
    if (!Array.isArray(chain) || chain.length < 2 || chain.some(name => typeof name !== 'string' || !name) || new Set(chain).size !== chain.length) {
      throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', `Invalid ${side} deform chain`);
    }
  }
  const capabilities = Object.entries(profile.capabilities);
  if (!capabilities.length || capabilities.some(([name, status]) => !name || !['unsupported', 'structurally_verified'].includes(status))) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Invalid capability declarations');
  }
  return profile;
}

function verifyCandidateAsset(profile, bytes) {
  validateRigCapabilityProfile(profile);
  if (!Buffer.isBuffer(bytes)) throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Asset bytes are required');
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== profile.asset.candidateSha256) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Candidate asset hash mismatch', {expected: profile.asset.candidateSha256, actual});
  }
}

function requireRigCapabilities(profile, requiredCapabilities) {
  validateRigCapabilityProfile(profile);
  if (!Array.isArray(requiredCapabilities) || requiredCapabilities.some(value => typeof value !== 'string' || !value)) {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Required capabilities must be an array of nonempty IDs');
  }
  for (const capability of requiredCapabilities) {
    if (!Object.hasOwn(profile.capabilities, capability) || profile.capabilities[capability] !== 'structurally_verified') {
      throw new RigCapabilityError(
        'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
        `Rig ${profile.id}@${profile.revision} does not declare ${capability} as structurally verified`,
        {capability, profileId: profile.id, profileRevision: profile.revision, profileSha256: profile.sha256},
      );
    }
  }
}

// Convert a scalar only; coordinate-frame transforms require calibrated axes.
function anthropometricToMeters(profile, amount, unit, side) {
  validateRigCapabilityProfile(profile);
  if (!Number.isFinite(amount)) throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'A finite anthropometric value is required');
  const globalUnits = {shoulderWidth: 'shoulderWidth', torsoReferenceHeight: 'torsoReferenceHeight'};
  const bilateralUnits = {upperArmLength: 'UpperArmLength', forearmLength: 'ForearmLength', handLength: 'HandLength'};
  let key = Object.hasOwn(globalUnits, unit) ? globalUnits[unit] : undefined;
  if (Object.hasOwn(bilateralUnits, unit)) {
    if (side !== 'left' && side !== 'right') throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'An explicit side is required for bilateral units');
    key = `${side}${bilateralUnits[unit]}`;
  }
  if (!key) throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', `Unknown anthropometric unit: ${unit}`);
  const result = amount * profile.anthropometricsM[key];
  if (!Number.isFinite(result)) throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Anthropometric conversion is not finite');
  return result;
}

function assertReachableTarget(profile, targetDistanceM, side) {
  validateRigCapabilityProfile(profile);
  if (side !== 'left' && side !== 'right') {
    throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'An explicit left or right side is required');
  }
  if (!Number.isFinite(targetDistanceM) || targetDistanceM < 0) {
    throw new RigCapabilityError('KINEMATIC.UNREACHABLE', 'Target distance must be a finite non-negative measurement');
  }
  const lengths = profile.anthropometricsM;
  const maximumReachM = lengths[`${side}UpperArmLength`] + lengths[`${side}ForearmLength`] + lengths[`${side}HandLength`];
  if (targetDistanceM > maximumReachM) {
    const excessDistanceM = Number((targetDistanceM - maximumReachM).toFixed(9));
    throw new RigCapabilityError(
      'KINEMATIC.UNREACHABLE',
      `Target ${targetDistanceM} m exceeds measured reach ${maximumReachM} m`,
      {
        side,
        targetDistanceM,
        maximumReachM,
        excessDistanceM,
        requiredCapability: 'arm.reachability',
        profileId: profile.id,
        profileRevision: profile.revision,
        profileSha256: profile.sha256,
      },
    );
  }
  throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', 'Distance within the outer bound does not establish reachability; a calibrated solver is required', {side, targetDistanceM, maximumReachM});
}

module.exports = {RigCapabilityError, anthropometricToMeters, assertReachableTarget, canonicalJson, profileSha256, restAxesInventorySha256, requireRigCapabilities, validateCoordinateCalibration, validateBoneRestAxesInventory, validateMechanicalObservationEvidenceReference, validateRigCapabilityProfile, verifyCandidateAsset};
