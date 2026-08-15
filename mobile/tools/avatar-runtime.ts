import * as THREE from 'three';

type ClipName = string;
type Point = [number, number, number];
type MotionFrame = {bodyHands: Point[]; face: Point[]};
type Motion = {fps: number; frames: MotionFrame[]};
type HeadShape = {center: THREE.Vector3; radiusX: number; radiusY: number; chin: THREE.Vector3};

declare global {
  interface Window {
    playVozualClip: (clip: string, playbackId: number) => void;
    ReactNativeWebView?: {postMessage: (message: string) => void};
  }
}

const host = document.getElementById('avatar') as HTMLDivElement;
const webFetch = window.fetch.bind(window);

// Android WebView does not let Three.js fetch local APK assets by default.
// This bridge is limited to the app's own file:// resources.
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const rawUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const resolvedUrl = new URL(rawUrl, window.location.href);
  if (resolvedUrl.protocol !== 'file:') return webFetch(input, init);
  return new Promise<Response>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', resolvedUrl.toString(), true);
    request.responseType = 'arraybuffer';
    request.onload = () => {
      if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
        reject(new Error(`Local asset returned ${request.status}: ${resolvedUrl.pathname}`));
        return;
      }
      resolve(new Response(request.response, {status: 200}));
    };
    request.onerror = () => reject(new Error(`Could not read local asset: ${resolvedUrl.pathname}`));
    request.send();
  });
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#202A38');
const ORTHOGRAPHIC_VIEW_HEIGHT = 3.7;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0.0, 0);
const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
host.appendChild(renderer.domElement);

const bodySegments: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
const handSegments: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15],
  [15, 16], [0, 17], [17, 18], [18, 19], [19, 20],
];
const segments: Array<[number, number]> = [
  ...bodySegments,
  [15, 33], [16, 54],
  ...handSegments.map(([start, end]) => [33 + start, 33 + end] as [number, number]),
  ...handSegments.map(([start, end]) => [54 + start, 54 + end] as [number, number]),
];
type ArmBinding = {shoulder: number; elbow: number; wrist: number; hip: number; handStart?: number};
const arms: Omit<ArmBinding, 'handStart'>[] = [
  {shoulder: 11, elbow: 13, wrist: 15, hip: 23},
  {shoulder: 12, elbow: 14, wrist: 16, hip: 24},
];

const lineGeometry = new THREE.BufferGeometry();
const linePositions = new Float32Array((segments.length + 1) * 6);
lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
const skeleton = new THREE.LineSegments(
  lineGeometry,
  new THREE.LineBasicMaterial({color: 0x20d6ce, linewidth: 2}),
);
scene.add(skeleton);
skeleton.renderOrder = 2;

// Keep landmarks in two layers: hands/body joints must be easy to read, while
// Face Mesh remains detailed without becoming a solid white mask.
const jointGeometry = new THREE.BufferGeometry();
const jointPositions = new Float32Array(75 * 3);
jointGeometry.setAttribute('position', new THREE.BufferAttribute(jointPositions, 3));
const joints = new THREE.Points(
  jointGeometry,
  // Hand joints are a primary part of a sign. Draw them over the simple
  // mannequin so every knuckle and fingertip remains readable on a phone.
  new THREE.PointsMaterial({
    color: 0xffffff,
    size: 4.2,
    sizeAttenuation: true,
    depthTest: false,
  }),
);
scene.add(joints);
joints.renderOrder = 3;

const faceGeometry = new THREE.BufferGeometry();
const facePositions = new Float32Array(468 * 3);
faceGeometry.setAttribute('position', new THREE.BufferAttribute(facePositions, 3));
const facePoints = new THREE.Points(
  faceGeometry,
  new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2.8,
    sizeAttenuation: true,
    depthTest: false,
  }),
);
scene.add(facePoints);
facePoints.renderOrder = 3;

// These landmark groups make non-manual LSC information legible on a small
// screen. They are still the captured Face Mesh coordinates, merely drawn in
// a stronger layer: eyes, eyebrows and especially the lips/mouth opening.
const expressionLandmarks = [
  33, 133, 159, 145, 263, 362, 386, 374,
  70, 105, 107, 336, 334, 300,
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
  78, 95, 88, 178, 87, 13, 14, 317, 402, 318, 324, 308, 415,
];
const expressionGeometry = new THREE.BufferGeometry();
const expressionPositions = new Float32Array(expressionLandmarks.length * 3);
expressionGeometry.setAttribute('position', new THREE.BufferAttribute(expressionPositions, 3));
const expressionPoints = new THREE.Points(
  expressionGeometry,
  new THREE.PointsMaterial({
    color: 0x8cfff8,
    size: 5.2,
    sizeAttenuation: true,
    depthTest: false,
  }),
);
scene.add(expressionPoints);
expressionPoints.renderOrder = 4;

const headGeometry = new THREE.BufferGeometry();
const headPositions = new Float32Array(25 * 3);
headGeometry.setAttribute('position', new THREE.BufferAttribute(headPositions, 3));
const head = new THREE.LineLoop(
  headGeometry,
  new THREE.LineBasicMaterial({color: 0xaebdce}),
);
scene.add(head);
head.renderOrder = 3;
// The 468 Face Mesh points already describe the head. An oval around them
// looks like a separate ball and hides the actual facial movement.
head.visible = false;

// A quiet filled silhouette makes the captured landmarks read as a person,
// not a wireframe diagram. It follows the recorded shoulders, hips and face.
const torsoGeometry = new THREE.BufferGeometry();
const torsoPositions = new Float32Array(4 * 3);
torsoGeometry.setAttribute('position', new THREE.BufferAttribute(torsoPositions, 3));
torsoGeometry.setIndex([0, 1, 2, 0, 2, 3]);
const torso = new THREE.Mesh(
  torsoGeometry,
  new THREE.MeshBasicMaterial({color: 0x33495c, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide}),
);
scene.add(torso);
torso.renderOrder = 0;

// Rounded articulated sections make the silhouette read as a person while
// the thin landmark skeleton remains available for the exact motion.
const mannequinSegments: Array<[number, number, number]> = [
  [11, 13, 0.15], [13, 15, 0.12], [12, 14, 0.15], [14, 16, 0.12],
  [23, 25, 0.18], [25, 27, 0.14], [24, 26, 0.18], [26, 28, 0.14],
];
const limbMaterial = new THREE.MeshBasicMaterial({
  color: 0x405a70,
  transparent: true,
  opacity: 0.96,
  depthWrite: false,
});
const limbCapsules = mannequinSegments.map(() => {
  // The unscaled capsule is two world units tall: a central section of one
  // and two round caps. It is scaled per captured shoulder/elbow/wrist pair.
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 12), limbMaterial);
  capsule.renderOrder = 1;
  scene.add(capsule);
  return capsule;
});
const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 12), limbMaterial);
neck.renderOrder = 1;
scene.add(neck);

const bodyJointGeometry = new THREE.BufferGeometry();
const bodyJointPositions = new Float32Array(12 * 3);
bodyJointGeometry.setAttribute('position', new THREE.BufferAttribute(bodyJointPositions, 3));
const bodyJoints = new THREE.Points(
  bodyJointGeometry,
  new THREE.PointsMaterial({color: 0x6be3dc, size: 5.0, sizeAttenuation: true, depthTest: false}),
);
scene.add(bodyJoints);
bodyJoints.renderOrder = 3;

const headFill = new THREE.Mesh(
  new THREE.CircleGeometry(1, 48),
  new THREE.MeshBasicMaterial({color: 0x3b5266, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide}),
);
scene.add(headFill);
headFill.renderOrder = 0;

const motions = new Map<ClipName, Motion>();
let activeMotion: Motion | undefined;
let activePlaybackId = 0;
let activeStartedAt = 0;
let lastFrame = -1;
let ended = false;
let displayedFrame: MotionFrame | undefined;
let returnStart: MotionFrame | undefined;
let returnTarget: MotionFrame | undefined;
let returnStartedAt = 0;
let activeArmBindings: ArmBinding[] | undefined;
let activeRestReference: MotionFrame | undefined;
// Captured fingers are meaningful while a sign is playing. Once the avatar is
// at rest, use the shared neutral silhouette instead of retaining a random
// palm orientation from the last captured frame.
let showCapturedHands = true;
let transitionStart: MotionFrame | undefined;
let transitionTarget: MotionFrame | undefined;
let transitionStartedAt = 0;
let pendingMotion: Motion | undefined;

const RETURN_TO_REST_SECONDS = 0.42;
const SIGN_TRANSITION_SECONDS = 0.18;

function send(type: string, detail: Record<string, unknown> = {}) {
  window.ReactNativeWebView?.postMessage(JSON.stringify({type, ...detail}));
}

function valid(point: Point | undefined): point is Point {
  return point != null && point.some(value => Math.abs(value) > 1e-8);
}

function world(point: Point): THREE.Vector3 {
  // This deliberately stays on the capture plane.  A perspective camera
  // changes limb proportions; the orthographic projection matches VOZUAL's
  // diagnostic overlay and therefore the recorded body dimensions.
  return new THREE.Vector3(
    (point[0] - 0.5) * 3.1,
    (0.57 - point[1]) * 3.1,
    0,
  );
}

function writePoint(
  target: Float32Array,
  offset: number,
  point: Point | undefined,
  project: (source: Point) => THREE.Vector3 = world,
) {
  const value = valid(point) ? project(point) : new THREE.Vector3(20, 20, 20);
  target[offset] = value.x;
  target[offset + 1] = value.y;
  target[offset + 2] = value.z;
  return value;
}

function faceAnchor(face: Point[]): Point | undefined {
  const forehead = face[10];
  const chin = face[152];
  const leftEye = face[33];
  const rightEye = face[263];
  if (!valid(forehead) || !valid(chin) || !valid(leftEye) || !valid(rightEye)) return undefined;
  return [
    (leftEye[0] + rightEye[0]) / 2,
    (forehead[1] + chin[1]) / 2,
    (forehead[2] + chin[2]) / 2,
  ];
}

function faceProject(anchor: Point): (source: Point) => THREE.Vector3 {
  // Preserve Face Mesh landmarks, with a modest vertical correction so the
  // head stays human-shaped beside the full body instead of looking flattened.
  return source => {
    const projected = world([
      anchor[0] + (source[0] - anchor[0]) * 1.05,
      anchor[1] + (source[1] - anchor[1]) * 1.18,
      source[2],
    ]);
    // Face Mesh is an informational layer and must stay visible above the
    // mannequin in Android's WebGL depth buffer.
    projected.z = 0.1;
    return projected;
  };
}

function fallbackHead(bodyHands: Point[]): HeadShape | undefined {
  const leftShoulder = bodyHands[11];
  const rightShoulder = bodyHands[12];
  if (!valid(leftShoulder) || !valid(rightShoulder)) return undefined;
  const shoulderWidth = Math.abs(leftShoulder[0] - rightShoulder[0]);
  if (shoulderWidth < 0.01) return undefined;
  const center = world([
    (leftShoulder[0] + rightShoulder[0]) / 2,
    Math.min(leftShoulder[1], rightShoulder[1]) - shoulderWidth * 0.78,
    0,
  ]);
  const radiusX = shoulderWidth * 3.1 * 0.32;
  const radiusY = shoulderWidth * 3.1 * 0.43;
  return {
    center,
    radiusX,
    radiusY,
    chin: new THREE.Vector3(center.x, center.y - radiusY * 0.86, center.z),
  };
}

function writeWorldPoint(target: Float32Array, offset: number, value: THREE.Vector3) {
  target[offset] = value.x;
  target[offset + 1] = value.y;
  target[offset + 2] = value.z;
}

function placeLimb(index: number, from: Point | undefined, to: Point | undefined, thickness: number) {
  const limb = limbCapsules[index];
  if (!valid(from) || !valid(to)) {
    limb.visible = false;
    return;
  }
  const start = world(from);
  const end = world(to);
  const direction = end.clone().sub(start);
  if (direction.lengthSq() < 1e-6) {
    limb.visible = false;
    return;
  }
  const length = direction.length();
  limb.visible = true;
  limb.position.copy(start).add(end).multiplyScalar(0.5);
  limb.position.z = 0.025;
  limb.rotation.set(0, 0, -Math.atan2(direction.x, direction.y));
  limb.scale.set(thickness, length / 2, thickness);
}

function placeNeck(from: THREE.Vector3 | undefined, to: THREE.Vector3 | undefined) {
  if (!from || !to) {
    neck.visible = false;
    return;
  }
  const direction = to.clone().sub(from);
  if (direction.lengthSq() < 1e-6) {
    neck.visible = false;
    return;
  }
  neck.visible = true;
  neck.position.copy(from).add(to).multiplyScalar(0.5);
  neck.position.z = 0.025;
  neck.rotation.set(0, 0, -Math.atan2(direction.x, direction.y));
  neck.scale.set(0.11, direction.length() / 2, 0.11);
}

function copyPoint(point: Point): Point {
  return [point[0], point[1], point[2]];
}

function mixPoint(start: Point, end: Point, amount: number): Point {
  if (!valid(start)) return copyPoint(end);
  if (!valid(end)) return copyPoint(start);
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount,
    start[2] + (end[2] - start[2]) * amount,
  ];
}

function mixFrame(start: MotionFrame, end: MotionFrame, amount: number): MotionFrame {
  return {
    bodyHands: start.bodyHands.map((point, index) => mixPoint(point, end.bodyHands[index] ?? point, amount)),
    face: start.face.map((point, index) => mixPoint(point, end.face[index] ?? point, amount)),
  };
}

function squaredDistance(first: Point, second: Point): number {
  // Pose and hand landmarks use different depth estimators. Their Z values
  // are therefore not comparable when deciding which wrist owns a hand.
  // Screen-plane distance keeps the hand attached to its visible arm.
  return (first[0] - second[0]) ** 2 + (first[1] - second[1]) ** 2;
}

function bindHandsToArms(frame: MotionFrame): ArmBinding[] {
  const bindings = arms.map(arm => ({...arm}));
  const firstHand = frame.bodyHands[33];
  const secondHand = frame.bodyHands[54];
  const firstWrist = frame.bodyHands[15];
  const secondWrist = frame.bodyHands[16];
  const hasFirst = valid(firstHand);
  const hasSecond = valid(secondHand);
  if (hasFirst && hasSecond && valid(firstWrist) && valid(secondWrist)) {
    const direct = squaredDistance(firstHand, firstWrist) + squaredDistance(secondHand, secondWrist);
    const crossed = squaredDistance(firstHand, secondWrist) + squaredDistance(secondHand, firstWrist);
    bindings[0].handStart = direct <= crossed ? 33 : 54;
    bindings[1].handStart = direct <= crossed ? 54 : 33;
  } else if (hasFirst || hasSecond) {
    const handStart = hasFirst ? 33 : 54;
    const hand = frame.bodyHands[handStart];
    if (valid(hand) && valid(firstWrist) && valid(secondWrist)) {
      bindings[squaredDistance(hand, firstWrist) <= squaredDistance(hand, secondWrist) ? 0 : 1].handStart = handStart;
    }
  }
  return bindings;
}

function bindingsForMotion(motion: Motion): ArmBinding[] {
  const stable = arms.map(arm => ({...arm}));
  // A tracker may exchange its left/right labels while a hand crosses the
  // torso. Choose each hand's arm from the first reliable frame and keep that
  // relationship for the whole sign.
  for (const frame of motion.frames) {
    const detected = bindHandsToArms(frame);
    detected.forEach((binding, index) => {
      if (stable[index].handStart === undefined && binding.handStart !== undefined) {
        stable[index].handStart = binding.handStart;
      }
    });
    if (stable.every(binding => binding.handStart !== undefined)) break;
  }
  return stable;
}

function frameSegments(frame: MotionFrame, armBindings: ArmBinding[]): Array<[number, number]> {
  const result: Array<[number, number]> = [...bodySegments];
  for (const arm of armBindings) {
    if (arm.handStart === undefined) continue;
    result.push([arm.wrist, arm.handStart]);
    result.push(...handSegments.map(([start, end]) => [arm.handStart! + start, arm.handStart! + end] as [number, number]));
  }
  return result;
}

function neutralArmBindings(): ArmBinding[] {
  return arms.map((arm, index) => ({...arm, handStart: index === 0 ? 33 : 54}));
}

function neutralHand(wrist: Point, outward: number): Point[] {
  const point = (x: number, y: number): Point => [wrist[0] + x, wrist[1] + y, wrist[2]];
  const fingers: Point[] = [copyPoint(wrist)];
  // Thumb, then index through little finger. These are a small, symmetric
  // neutral hand under the wrist; they are only used while the avatar waits.
  fingers.push(point(outward * 0.040, 0.012), point(outward * 0.068, 0.035), point(outward * 0.080, 0.061), point(outward * 0.088, 0.083));
  const columns = [-0.044, -0.015, 0.015, 0.044];
  const lengths = [0.090, 0.120, 0.114, 0.095];
  columns.forEach((column, finger) => {
    const length = lengths[finger];
    fingers.push(
      point(column, 0.022),
      point(column, length * 0.48),
      point(column, length * 0.78),
      point(column, length),
    );
  });
  return fingers;
}

function makeRestPose(frame: MotionFrame, armBindings = activeArmBindings ?? bindHandsToArms(frame)): MotionFrame {
  const bodyHands = frame.bodyHands.map(copyPoint);
  const face = frame.face.map(copyPoint);

  // Every sign returns to one neutral mannequin pose.  Do not use the last
  // tracked wrist as its target: a hand near the face could otherwise finish
  // at a different side or retain an impossible horizontal palm.
  for (const side of armBindings) {
    const shoulder = bodyHands[side.shoulder];
    const hip = bodyHands[side.hip];
    const wrist = bodyHands[side.wrist];
    if (!valid(shoulder) || !valid(hip) || !valid(wrist)) continue;

    const restWrist: Point = [
      hip[0] + (shoulder[0] - hip[0]) * 1.12,
      shoulder[1] + (hip[1] - shoulder[1]) * 0.88,
      hip[2],
    ];
    const restElbow: Point = [
      shoulder[0] + (restWrist[0] - shoulder[0]) * 0.49,
      shoulder[1] + (restWrist[1] - shoulder[1]) * 0.49,
      shoulder[2] + (restWrist[2] - shoulder[2]) * 0.49,
    ];
    bodyHands[side.elbow] = restElbow;
    bodyHands[side.wrist] = restWrist;
    if (side.handStart === undefined) continue;
    const outward = shoulder[0] >= 0.5 ? 1 : -1;
    neutralHand(restWrist, outward).forEach((point, index) => {
      bodyHands[side.handStart! + index] = point;
    });
  }
  return {bodyHands, face};
}

function setFrame(frame: MotionFrame) {
  displayedFrame = frame;
  const bodyHands = frame.bodyHands;
  const face = frame.face;
  const armBindings = activeArmBindings ?? bindHandsToArms(frame);
  const anchor = faceAnchor(face);
  const fallback = anchor ? undefined : fallbackHead(bodyHands);
  const projectFace = anchor ? faceProject(anchor) : world;
  let offset = 0;
  const renderedBindings = showCapturedHands
    ? armBindings
    : armBindings.map(binding => ({...binding, handStart: undefined}));
  for (const [start, end] of frameSegments(frame, renderedBindings)) {
    writePoint(linePositions, offset, bodyHands[start]);
    writePoint(linePositions, offset + 3, bodyHands[end]);
    offset += 6;
  }
  // A rest frame has no captured finger segments. Clear the unused tail of
  // the GPU buffer so a previous sign cannot leave a ghost hand behind.
  linePositions.fill(20, offset);
  const shoulderLeft = valid(bodyHands[11]) ? world(bodyHands[11]) : undefined;
  const shoulderRight = valid(bodyHands[12]) ? world(bodyHands[12]) : undefined;
  const chin = valid(face[152]) && anchor ? projectFace(face[152]) : fallback?.chin;
  // The neck is rendered as a short rounded capsule below, not a skeleton
  // line, so the human silhouette stays clean.

  for (let index = 0; index < 33; index += 1) {
    // Pose indexes 0–10 are sparse facial hints.  They are not useful by
    // themselves and look like floating dots if Face Mesh is unavailable.
    writePoint(jointPositions, index * 3, index < 11 && !anchor ? undefined : bodyHands[index]);
  }
  const visibleHands = new Set(renderedBindings.flatMap(arm => arm.handStart === undefined ? [] : [arm.handStart]));
  for (const handStart of [33, 54]) {
    for (let index = handStart; index < handStart + 21; index += 1) {
      writePoint(
        jointPositions,
        index * 3,
        visibleHands.has(handStart) ? bodyHands[index] : undefined,
      );
    }
  }
  for (let index = 0; index < face.length; index += 1) {
    writePoint(facePositions, index * 3, anchor ? face[index] : undefined, projectFace);
  }
  expressionLandmarks.forEach((landmark, index) => {
    writePoint(
      expressionPositions,
      index * 3,
      anchor ? face[landmark] : undefined,
      projectFace,
    );
  });
  if (fallback) {
    const features = [
      new THREE.Vector3(fallback.center.x - fallback.radiusX * 0.34, fallback.center.y + fallback.radiusY * 0.12, 0),
      new THREE.Vector3(fallback.center.x + fallback.radiusX * 0.34, fallback.center.y + fallback.radiusY * 0.12, 0),
      new THREE.Vector3(fallback.center.x, fallback.center.y, 0),
      new THREE.Vector3(fallback.center.x - fallback.radiusX * 0.22, fallback.center.y - fallback.radiusY * 0.28, 0),
      new THREE.Vector3(fallback.center.x + fallback.radiusX * 0.22, fallback.center.y - fallback.radiusY * 0.28, 0),
    ];
    features.forEach((feature, index) => writeWorldPoint(jointPositions, index * 3, feature));
  }
  lineGeometry.attributes.position.needsUpdate = true;
  jointGeometry.attributes.position.needsUpdate = true;
  faceGeometry.attributes.position.needsUpdate = true;
  expressionGeometry.attributes.position.needsUpdate = true;

  const torsoCorners = [bodyHands[11], bodyHands[12], bodyHands[24], bodyHands[23]];
  if (torsoCorners.every(valid)) {
    torsoCorners.forEach((corner, index) => writeWorldPoint(torsoPositions, index * 3, world(corner)));
  } else {
    torsoPositions.fill(20);
  }
  torsoGeometry.attributes.position.needsUpdate = true;
  placeNeck(
    shoulderLeft && shoulderRight ? shoulderLeft.clone().add(shoulderRight).multiplyScalar(0.5) : undefined,
    chin,
  );

  mannequinSegments.forEach(([start, end, thickness], index) => {
    placeLimb(index, bodyHands[start], bodyHands[end], thickness);
  });

  // These are the larger anatomical joints: shoulder, elbow, wrist, hip,
  // knee and ankle. The exact smaller landmarks remain in the white layer.
  const majorJointIndexes = [11, 13, 15, 12, 14, 16, 23, 25, 27, 24, 26, 28];
  majorJointIndexes.forEach((joint, index) => {
    writePoint(bodyJointPositions, index * 3, bodyHands[joint]);
  });
  bodyJointGeometry.attributes.position.needsUpdate = true;

  const forehead = valid(face[10]) ? projectFace(face[10]) : undefined;
  const leftEye = valid(face[33]) ? projectFace(face[33]) : undefined;
  const rightEye = valid(face[263]) ? projectFace(face[263]) : undefined;
  if (forehead && leftEye && rightEye && chin) {
    const center = forehead.clone().add(chin).multiplyScalar(0.5);
    // The face landmarks may have a taller camera aspect ratio. The displayed
    // mannequin keeps a fixed human head ratio while retaining every landmark.
    const radiusX = Math.max(0.34, leftEye.distanceTo(rightEye) * 1.18);
    const radiusY = radiusX * 1.2;
    writeHeadShape(center, radiusX, radiusY);
  } else if (fallback) {
    writeHeadShape(fallback.center, fallback.radiusX, fallback.radiusY);
  } else {
    headPositions.fill(20);
    headFill.visible = false;
  }
  headGeometry.attributes.position.needsUpdate = true;
}

function writeHeadShape(center: THREE.Vector3, radiusX: number, radiusY: number) {
  // Keep only the outline. The Face Mesh itself supplies the facial detail.
  headFill.visible = false;
  for (let index = 0; index < 25; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * radiusX;
    const y = center.y + Math.sin(angle) * radiusY;
    headPositions[index * 3] = x;
    headPositions[index * 3 + 1] = y;
    headPositions[index * 3 + 2] = center.z;
  }
}

function rangeFor(points: Point[]): {minX: number; maxX: number; minY: number; maxY: number} | undefined {
  const usable = points.filter(valid);
  if (usable.length === 0) return undefined;
  return {
    minX: Math.min(...usable.map(point => point[0])),
    maxX: Math.max(...usable.map(point => point[0])),
    minY: Math.min(...usable.map(point => point[1])),
    maxY: Math.max(...usable.map(point => point[1])),
  };
}

function retargetMotion(motion: Motion): Motion {
  // A phone video records camera coordinates, not avatar coordinates. Each
  // recording has a different zoom and framing, so normalize it once around
  // its shoulders and torso before drawing it on the fixed mannequin.
  const reference = motion.frames[0];
  const leftShoulder = reference.bodyHands[11];
  const rightShoulder = reference.bodyHands[12];
  const leftHip = reference.bodyHands[23];
  const rightHip = reference.bodyHands[24];
  if (!valid(leftShoulder) || !valid(rightShoulder) || !valid(leftHip) || !valid(rightHip)) return motion;
  const shoulderCenter: Point = [
    (leftShoulder[0] + rightShoulder[0]) / 2,
    (leftShoulder[1] + rightShoulder[1]) / 2,
    0,
  ];
  const hipY = (leftHip[1] + rightHip[1]) / 2;
  const shoulderWidth = Math.max(0.001, Math.abs(leftShoulder[0] - rightShoulder[0]));
  const torsoHeight = Math.max(0.001, Math.abs(hipY - shoulderCenter[1]));
  const bodyScaleX = 0.42 / shoulderWidth;
  const bodyScaleY = 0.47 / torsoHeight;
  const sourceFaceBounds = rangeFor(reference.face);
  const sourceFaceCenter = sourceFaceBounds
    ? [(sourceFaceBounds.minX + sourceFaceBounds.maxX) / 2, (sourceFaceBounds.minY + sourceFaceBounds.maxY) / 2] as const
    : undefined;
  const faceScaleX = sourceFaceBounds ? 0.22 / Math.max(0.001, sourceFaceBounds.maxX - sourceFaceBounds.minX) : 1;
  const faceScaleY = sourceFaceBounds ? 0.30 / Math.max(0.001, sourceFaceBounds.maxY - sourceFaceBounds.minY) : 1;

  const retargetBody = (point: Point): Point => !valid(point) ? point : [
    0.5 + (point[0] - shoulderCenter[0]) * bodyScaleX,
    0.68 + (point[1] - shoulderCenter[1]) * bodyScaleY,
    point[2],
  ];
  const retargetFace = (point: Point): Point => !valid(point) || !sourceFaceCenter ? point : [
    0.5 + (point[0] - sourceFaceCenter[0]) * faceScaleX,
    0.39 + (point[1] - sourceFaceCenter[1]) * faceScaleY,
    point[2],
  ];
  return {
    fps: motion.fps,
    frames: motion.frames.map(frame => ({
      bodyHands: frame.bodyHands.map(retargetBody),
      face: frame.face.map(retargetFace),
    })),
  };
}

async function loadMotion(clip: string) {
  const response = await fetch(`./motions/${clip.toLowerCase()}.motion.json`);
  if (!response.ok) throw new Error(`No se pudo cargar el movimiento ${clip}.`);
  const motion = await response.json() as Motion;
  if (!Array.isArray(motion.frames) || motion.frames.length < 2) {
    throw new Error(`El movimiento ${clip} no contiene cuadros suficientes.`);
  }
  motions.set(clip, retargetMotion(motion));
}

function playClip(clip: ClipName, playbackId: number) {
  if (clip === 'IDLE') {
    activeMotion = undefined;
    pendingMotion = undefined;
    transitionStart = undefined;
    transitionTarget = undefined;
    if (displayedFrame) {
      showCapturedHands = true;
      returnStart = displayedFrame;
      // Return to the exact side and horizontal position where this sign
      // started. Never derive a new side from its last tracked wrist.
      activeArmBindings = neutralArmBindings();
      returnTarget = makeRestPose(activeRestReference ?? displayedFrame, activeArmBindings);
      returnStartedAt = performance.now();
    } else {
      const idle = motions.values().next().value?.frames[0] as MotionFrame | undefined;
      if (idle) {
        activeArmBindings = neutralArmBindings();
        setFrame(makeRestPose(idle, activeArmBindings));
      }
    }
    return;
  }
  const motion = motions.get(clip.toUpperCase());
  if (!motion) return;
  showCapturedHands = true;
  activeArmBindings = bindingsForMotion(motion);
  activeRestReference = motion.frames[0];
  returnStart = undefined;
  returnTarget = undefined;
  activePlaybackId = playbackId;
  lastFrame = -1;
  ended = false;
  // A spoken next word can arrive while the previous hand is returning to
  // rest. Blend directly from that visible pose to the next sign's first
  // captured pose; do not force an artificial return to zero in between.
  if (displayedFrame) {
    activeMotion = undefined;
    transitionStart = displayedFrame;
    transitionTarget = motion.frames[0];
    transitionStartedAt = performance.now();
    pendingMotion = motion;
    return;
  }
  pendingMotion = undefined;
  activeMotion = motion;
  activeStartedAt = performance.now();
  setFrame(motion.frames[0]);
}

window.playVozualClip = playClip;

function resize() {
  const width = Math.max(1, window.innerWidth, host.clientWidth);
  const height = Math.max(1, window.innerHeight, host.clientHeight);
  renderer.setSize(width, height, false);
  const halfHeight = ORTHOGRAPHIC_VIEW_HEIGHT / 2;
  const halfWidth = halfHeight * (width / height);
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (transitionStart && transitionTarget && pendingMotion) {
    const linearProgress = Math.min(1, (performance.now() - transitionStartedAt) / (SIGN_TRANSITION_SECONDS * 1000));
    const smoothProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
    setFrame(mixFrame(transitionStart, transitionTarget, smoothProgress));
    if (linearProgress >= 1) {
      const nextMotion = pendingMotion;
      transitionStart = undefined;
      transitionTarget = undefined;
      pendingMotion = undefined;
      activeMotion = nextMotion;
      activeStartedAt = performance.now();
      lastFrame = -1;
      setFrame(nextMotion.frames[0]);
    }
  } else if (returnStart && returnTarget) {
    const linearProgress = Math.min(1, (performance.now() - returnStartedAt) / (RETURN_TO_REST_SECONDS * 1000));
    const smoothProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
    setFrame(mixFrame(returnStart, returnTarget, smoothProgress));
    if (linearProgress >= 1) {
      returnStart = undefined;
      returnTarget = undefined;
      setFrame(returnTarget);
    }
  } else if (activeMotion) {
    const elapsed = (performance.now() - activeStartedAt) / 1000;
    const frameIndex = Math.min(
      activeMotion.frames.length - 1,
      Math.floor(elapsed * Math.max(1, activeMotion.fps)),
    );
    if (frameIndex !== lastFrame) {
      setFrame(activeMotion.frames[frameIndex]);
      lastFrame = frameIndex;
    }
    if (frameIndex === activeMotion.frames.length - 1 && !ended) {
      ended = true;
      send('ended', {playbackId: activePlaybackId});
    }
  }
  renderer.render(scene, camera);
}

async function loadPublishedMotions() {
  const response = await fetch('./motions/published_signs.json');
  if (!response.ok) throw new Error('No se pudo cargar el catálogo de señas publicadas.');
  const catalog = await response.json() as {publishedGlosses?: unknown};
  const clips = Array.isArray(catalog.publishedGlosses)
    ? catalog.publishedGlosses.map(value => String(value).trim().toUpperCase()).filter(Boolean)
    : [];
  if (clips.length === 0) throw new Error('No hay señas publicadas en la app.');
  await Promise.all(clips.map(loadMotion));
  return clips;
}

loadPublishedMotions()
  .then((clips) => {
    playClip('IDLE', 0);
    send('ready', {clips: ['IDLE', ...clips]});
  })
  .catch(error => send('error', {message: error instanceof Error ? error.message : String(error)}));

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(host);
resize();
animate();
