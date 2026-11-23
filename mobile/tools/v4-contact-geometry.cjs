'use strict';

const {createHash} = require('node:crypto');
const {readFileSync, realpathSync} = require('node:fs');
const path = require('node:path');
const {Matrix4, Quaternion, Vector3} = require('three');
const {readGlbJson} = require('./audit-rig-command-axes.cjs');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');

const HAND_FRAME_MATCH_M = 0.000001;

function calibrationError(message) {
  throw new RigCapabilityError('COMPATIBILITY.RIG_PROFILE', message);
}

function finitePoint(value) {
  return Array.isArray(value) && value.length === 3 && [...value].every(Number.isFinite);
}

function quaternionPoseRotations(commands, fraction = 1, boneWindows = {}) {
  if (fraction === 0) return new Map();
  return new Map(Object.entries(commands).map(([bone, [w, x, y, z]]) => {
    const target = new Quaternion(x, y, z, w).normalize();
    const [from, to] = boneWindows[bone] ?? [0, 1];
    const amount = Math.min(1, Math.max(0, (fraction - from) / (to - from)));
    const rotation = new Quaternion().slerp(target, amount);
    return [bone, new Matrix4().makeRotationFromQuaternion(rotation)];
  }));
}

function readCalibratedRestPoints(calibration, options, anchorIds) {
  let bytes;
  try {
    const root = realpathSync(options.evidenceRoot || process.env.VOZUAL_TASK3_14B_EVIDENCE_ROOT);
    const file = realpathSync(path.resolve(root, calibration.measurementArtifact));
    const relative = path.relative(root, file);
    if (path.isAbsolute(calibration.measurementArtifact) || !relative ||
        relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      calibrationError('Point contact calibration path must stay within the evidence root');
    }
    bytes = readFileSync(file);
  } catch (error) {
    if (error instanceof RigCapabilityError) throw error;
    calibrationError('Point contact calibration artifact is unavailable');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== calibration.measurementSha256) {
    calibrationError('Point contact calibration artifact checksum mismatch');
  }
  let report;
  try {
    report = JSON.parse(bytes.toString('utf8'));
  } catch {
    calibrationError('Point contact calibration artifact is not valid JSON');
  }
  if (!Array.isArray(report?.anchors)) calibrationError('Point contact calibration requires an anchor inventory');
  return new Map(anchorIds.map(id => {
    const matches = report.anchors.filter(anchor => anchor?.id === id);
    if (matches.length !== 1 || matches[0].kind !== 'point' || !finitePoint(matches[0].bodyPositionM)) {
      calibrationError(`Point contact calibration must provide one finite rest anchor for ${id}`);
    }
    return [id, new Vector3().fromArray(matches[0].bodyPositionM)];
  }));
}

function nodeRestMatrix(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3().fromArray(node.translation || [0, 0, 0]),
    new Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
    new Vector3().fromArray(node.scale || [1, 1, 1]),
  );
}

function chainTransform(chain, rotations) {
  const transform = new Matrix4();
  for (const {name, rest} of chain) {
    transform.multiply(rest);
    const rotation = rotations.get(name);
    if (rotation) transform.multiply(rotation);
  }
  const determinant = transform.determinant();
  if (!transform.elements.every(Number.isFinite) || !Number.isFinite(determinant) || determinant === 0) {
    calibrationError('Point contact bone transform is invalid');
  }
  return transform;
}

function createCalibratedAnchorResolver(profile, candidateBytes, options, anchorBones) {
  const calibration = profile.descriptor.coordinateCalibration;
  const restByAnchor = readCalibratedRestPoints(calibration, options, Object.keys(anchorBones));
  const {axes, originM} = calibration.body;
  const bodyToWorld = new Matrix4().makeBasis(
    ...['x', 'y', 'z'].map(axis => new Vector3().fromArray(axes[axis])),
  ).setPosition(new Vector3().fromArray(originM));
  if (bodyToWorld.determinant() <= 0) calibrationError('Calibrated body frame is invalid');
  const worldToBody = bodyToWorld.clone().invert();
  const {nodes} = readGlbJson(candidateBytes);
  const parents = new Map();
  const indicesByName = new Map();
  nodes.forEach((node, index) => {
    const indices = indicesByName.get(node.name) || [];
    indices.push(index);
    indicesByName.set(node.name, indices);
    for (const child of node.children || []) {
      if (parents.has(child)) calibrationError('Point contact GLB hierarchy has multiple parents');
      parents.set(child, index);
    }
  });
  const neutral = new Map();
  const bindings = Object.entries(anchorBones).map(([id, bone]) => {
    const endpoint = indicesByName.get(bone);
    if (endpoint?.length !== 1) calibrationError(`Point contact endpoint bone is missing or ambiguous: ${bone}`);
    const chain = [];
    const seen = new Set();
    for (let index = endpoint[0]; index !== undefined; index = parents.get(index)) {
      if (seen.has(index) || !nodes[index]) calibrationError('Invalid point contact bone hierarchy');
      seen.add(index);
      chain.unshift({name: nodes[index].name, rest: nodeRestMatrix(nodes[index])});
    }
    const rest = restByAnchor.get(id);
    // Store the measured rest point in the terminal bone's local space.
    const offset = rest.clone().applyMatrix4(bodyToWorld).applyMatrix4(chainTransform(chain, neutral).invert());
    return {id, chain, rest, offset};
  });
  return rotations => {
    for (const bone of rotations.keys()) {
      if (indicesByName.get(bone)?.length !== 1) {
        calibrationError(`Point contact pose bone is missing or ambiguous: ${bone}`);
      }
    }
    return new Map(bindings.map(({id, chain, rest, offset}) => {
      if (!rotations.size) return [id, rest.toArray()];
      const point = offset.clone().applyMatrix4(chainTransform(chain, rotations)).applyMatrix4(worldToBody).toArray();
      if (!finitePoint(point)) calibrationError(`Nonfinite transformed anchor for ${id}`);
      return [id, point];
    }));
  };
}

function createCalibratedHandFrameResolver(profile, candidateBytes, options) {
  const calibration = profile.descriptor.coordinateCalibration;
  const restByAnchor = readCalibratedRestPoints(calibration, options, ['hand.palm.left', 'hand.palm.right']);
  const bodyToWorld = new Matrix4().makeBasis(
    ...['x', 'y', 'z'].map(axis => new Vector3().fromArray(calibration.body.axes[axis])),
  ).setPosition(new Vector3().fromArray(calibration.body.originM));
  if (bodyToWorld.determinant() <= 0) calibrationError('Calibrated body frame is invalid');
  const worldToBody = bodyToWorld.clone().invert();
  const {nodes} = readGlbJson(candidateBytes);
  const parents = new Map();
  const indicesByName = new Map();
  nodes.forEach((node, index) => {
    const indices = indicesByName.get(node.name) || [];
    indices.push(index);
    indicesByName.set(node.name, indices);
    for (const child of node.children || []) {
      if (parents.has(child)) calibrationError('Hand-frame GLB hierarchy has multiple parents');
      parents.set(child, index);
    }
  });
  const neutral = new Map();
  const bindings = ['left', 'right'].map(side => {
    const id = `hand.palm.${side}`;
    const bone = `DEF-hand.${side === 'left' ? 'L' : 'R'}`;
    const endpoint = indicesByName.get(bone);
    if (endpoint?.length !== 1) calibrationError(`Calibrated hand bone is missing or ambiguous: ${bone}`);
    const chain = [];
    const seen = new Set();
    for (let index = endpoint[0]; index !== undefined; index = parents.get(index)) {
      if (seen.has(index) || !nodes[index]) calibrationError('Invalid hand-frame bone hierarchy');
      seen.add(index);
      chain.unshift({name: nodes[index].name, rest: nodeRestMatrix(nodes[index])});
    }
    const handCalibration = calibration.hand[side];
    const handFrameWorld = new Matrix4().makeBasis(
      ...['x', 'y', 'z'].map(axis => new Vector3().fromArray(handCalibration.axes[axis])),
    ).setPosition(new Vector3().fromArray(handCalibration.originM));
    if (handFrameWorld.determinant() <= 0) calibrationError(`Calibrated ${side} hand frame is invalid`);
    const handRestBodyPosition = new Vector3().fromArray(handCalibration.originM).applyMatrix4(worldToBody);
    if (handRestBodyPosition.distanceTo(new Vector3().fromArray(restByAnchor.get(id))) > HAND_FRAME_MATCH_M) {
      calibrationError(`Calibrated ${side} hand origin does not match its measured palm anchor`);
    }
    const localFrame = chainTransform(chain, neutral).invert().multiply(handFrameWorld);
    return {id, chain, localFrame};
  });
  return rotations => {
    for (const bone of rotations.keys()) {
      if (indicesByName.get(bone)?.length !== 1) calibrationError(`Hand-frame pose bone is missing or ambiguous: ${bone}`);
    }
    return new Map(bindings.map(({id, chain, localFrame}) => {
      const bodyFrame = worldToBody.clone().multiply(chainTransform(chain, rotations)).multiply(localFrame);
      if (!bodyFrame.elements.every(Number.isFinite) || bodyFrame.determinant() <= 0) {
        calibrationError(`Calibrated hand frame is invalid for ${id}`);
      }
      const positionM = new Vector3().setFromMatrixPosition(bodyFrame).toArray();
      const orientation = new Quaternion().setFromRotationMatrix(bodyFrame).normalize();
      const orientationWxyz = [orientation.w, orientation.x, orientation.y, orientation.z];
      if (!finitePoint(positionM) || !orientationWxyz.every(Number.isFinite)) {
        calibrationError(`Calibrated hand transform is nonfinite for ${id}`);
      }
      return [id, {positionM, orientationWxyz}];
    }));
  };
}

module.exports = {
  calibrationError,
  createCalibratedAnchorResolver,
  createCalibratedHandFrameResolver,
  finitePoint,
  quaternionPoseRotations,
};
