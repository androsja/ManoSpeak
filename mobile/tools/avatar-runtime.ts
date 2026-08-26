import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {
  decodeCompactMotion,
  MotionFrame,
  MotionPoint as Point,
  SignMotion as Motion,
} from '../src/services/CompactSignMotion';
import {
  buildCartoonHandGeometry,
  CartoonHandPoint,
} from '../src/services/CartoonHandGeometry';
import {chooseFrontCartoonHand} from '../src/services/CartoonHandLayering';
import {buildCartoonBodyGeometry} from '../src/services/CartoonBodyGeometry';
import {buildCartoonFaceGeometry} from '../src/services/CartoonFaceGeometry';
import {
  adaptFaceOverlayPoint,
  capturedFacePresentation,
  capturedFaceCalibration,
  capturedHeadOrientation,
  contactPresentationWeight,
  livelyIdleBodyPresentation,
  livelyIdleFacePresentation,
  livelyIdleGazePresentation,
  presentAnatomicalHandLandmarkFrames,
  presentCapturedHandLandmarkFrames,
  presentFistHandLandmarkFrames,
  presentIndexOnlyHandLandmarkFrames,
  presentPointingHandLandmarkFrames,
  presentSelfPointingHandLandmarkFrames,
  presentThumbUpHandLandmarkFrames,
  RiggedHandPresentation,
  riggedPalmScaleFactor,
  shouldDrivePointingHandSegment,
  shouldDriveStableOpenHandSegment,
  shouldUseSingleHandRig,
  softenFingerCurlLandmarks,
  splitCapturedHeadOrientation,
  straightenOpenHandLandmarks,
  type CapturedFaceCalibration,
} from '../src/services/AvatarMotionPresentation';
import {
  coarticulateSignMotion,
  PHRASE_COAST_TO_REST_RATIO,
  PHRASE_CONTINUATION_GRACE_MS,
  signPlaybackRange,
} from '../src/services/SignPhraseContinuity';
import {
  armMotionScore,
  AvatarArmBinding as ArmBinding,
  AVATAR_ARMS as arms,
  bindHandsToArms,
  bindingsForMotion,
  presentationArmIndexes,
} from '../src/services/AvatarMotionBinding';
import {
  repairStablePalmHandLandmarkFrames,
  RiggedHandTrackingRepair,
} from '../src/services/CapturedHandTrackingQuality';

type ClipName = string;
type RenderMode = 'points' | 'hybrid' | 'cartoon' | 'rigged';
type PlaybackState = {
  active: boolean;
  paused: boolean;
  positionMs: number;
  durationMs: number;
  frameIndex: number;
};
type HeadShape = {center: THREE.Vector3; radiusX: number; radiusY: number; chin: THREE.Vector3};
type AvatarProfile = {
  activeHand?: 'left' | 'right';
  contactAnchor?: string;
  contactStartFrame?: number;
  contactEndFrame?: number;
  palmAtContact?: string;
  rigContactBias?: number;
  rigContactLandmark?: number;
  rigContactSnap?: number;
  rigContactUseAvatarAnchor?: boolean;
  rigStableOpenHand?: boolean;
  rigSoftHandCurl?: boolean;
  rigPointingHand?: boolean;
  rigSelfPointingHand?: boolean;
  forceTwoHands?: boolean;
  rigFistHands?: boolean;
  rigHandFrontDepth?: number;
  rigLeftHandShape?: RiggedHandPresentation;
  rigRightHandShape?: RiggedHandPresentation;
  rigPalmScaleMin?: number;
  rigPalmScaleMax?: number;
  rigLeftPalmScaleMin?: number;
  rigLeftPalmScaleMax?: number;
  rigRightPalmScaleMin?: number;
  rigRightPalmScaleMax?: number;
  rigLeftHandFrontDepth?: number;
  rigRightHandFrontDepth?: number;
  rigLeftHandDepthScale?: number;
  rigRightHandDepthScale?: number;
  rigLeftHandTrackingRepair?: RiggedHandTrackingRepair;
  rigRightHandTrackingRepair?: RiggedHandTrackingRepair;
};

declare global {
  interface Window {
    playVozualClip: (clip: string, playbackId: number, playbackSpeed?: number, continuePhrase?: boolean) => void;
    setVozualPlaybackPaused: (paused: boolean) => boolean;
    seekVozualPlayback: (positionMs: number) => PlaybackState;
    getVozualPlaybackState: () => PlaybackState;
    setVozualAvatarZoom: (zoom: number) => void;
    setVozualAvatarVerticalOffset: (offset: number) => void;
    setVozualRenderMode: (mode: RenderMode) => void;
    tickVozualAnimation: () => boolean;
    setVozualDebugFrame: (clip: string, frameIndex: number) => boolean;
    getVozualRigDiagnostics: () => Record<string, unknown>;
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
// The WebGL loop starts immediately, before motions and the rigged character
// have finished loading. Keep every scene object hidden until the initial rest
// pose is ready; otherwise Three.js briefly paints zero-position geometry as
// a large circle/capsule (and sometimes the landmark points) in Home and PiP.
scene.visible = false;
const ORTHOGRAPHIC_VIEW_HEIGHT = 3.7;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0.0, 0);
const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
host.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x263447, 0.9));
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
// A centered, soft key light keeps both signing hands equally legible. The
// previous lateral light exaggerated the character's facial normal map and
// looked like a dark cavity on the nose plus a clipped white cheek.
const avatarKeyLight = new THREE.DirectionalLight(0xffffff, 0.48);
avatarKeyLight.position.set(0, 2.5, 7);
scene.add(avatarKeyLight);

// The purchased character is optional and never replaces the landmark data.
// PUNTOS and CARICATURA remain available as exact comparison/fallback modes.
let riggedAvatar: THREE.Group | undefined;
let riggedBones = new Map<string, THREE.Bone>();
let riggedBoneRests = new Map<string, {
  direction: THREE.Vector3;
  quaternion: THREE.Quaternion;
  localQuaternion: THREE.Quaternion;
  localPosition: THREE.Vector3;
  localScale: THREE.Vector3;
  localEndpoint: THREE.Vector3;
  lengthAxis: 'x' | 'y' | 'z';
  length: number;
}>();
let riggedPalmRests = new Map<'L' | 'R', {
  localLongitudinal: THREE.Vector3;
  localLateral: THREE.Vector3;
}>();
let riggedArmLengths = new Map<'L' | 'R', {upper: number; lower: number; hand: number}>();
let activeRiggedForearmLengths = new Map<'L' | 'R', number>();
let riggedAligned = false;
let riggedVerticalAdjustment = 0;
let riggedIdleRootVerticalOffset = 0;
let riggedIdleRootRotationZ = 0;
let riggedIdleRootScale = 1;
const AVATAR_CAMERA_ZOOM_MIN = 0.55;
const AVATAR_CAMERA_ZOOM_MAX = 1.3;

window.setVozualAvatarZoom = (zoom: number) => {
  const requestedZoom = Number.isFinite(zoom) ? zoom : 1;
  camera.zoom = Math.min(AVATAR_CAMERA_ZOOM_MAX, Math.max(AVATAR_CAMERA_ZOOM_MIN, requestedZoom));
  camera.updateProjectionMatrix();
};

window.setVozualAvatarVerticalOffset = (offset: number) => {
  const nextOffset = Math.min(0.25, Math.max(-0.25, Number.isFinite(offset) ? offset : 0));
  if (riggedAvatar) riggedAvatar.position.y += nextOffset - riggedVerticalAdjustment;
  riggedVerticalAdjustment = nextOffset;
};

const riggedFingerTargets: Array<[string, number, number]> = [
  ['thumb.01', 1, 2], ['thumb.02', 2, 3], ['thumb.03', 3, 4],
  ['f_index.01', 5, 6], ['f_index.02', 6, 7], ['f_index.03', 7, 8],
  ['f_middle.01', 9, 10], ['f_middle.02', 10, 11], ['f_middle.03', 11, 12],
  ['f_ring.01', 13, 14], ['f_ring.02', 14, 15], ['f_ring.03', 15, 16],
  ['f_pinky.01', 17, 18], ['f_pinky.02', 18, 19], ['f_pinky.03', 19, 20],
];

const riggedSmileBones = [
  'DEF-lip.T.L.001', 'DEF-lip.B.L.001',
  'DEF-lip.T.R.001', 'DEF-lip.B.R.001',
  'DEF-cheek.B.L', 'DEF-cheek.B.R',
];
const riggedLeftLidBones = [
  'DEF-lid.T.L', 'DEF-lid.T.L.001', 'DEF-lid.T.L.002', 'DEF-lid.T.L.003',
  'DEF-lid.B.L', 'DEF-lid.B.L.001', 'DEF-lid.B.L.002', 'DEF-lid.B.L.003',
];
const riggedRightLidBones = [
  'DEF-lid.T.R', 'DEF-lid.T.R.001', 'DEF-lid.T.R.002', 'DEF-lid.T.R.003',
  'DEF-lid.B.R', 'DEF-lid.B.R.001', 'DEF-lid.B.R.002', 'DEF-lid.B.R.003',
];
const riggedLeftInnerBrowBones = [
  'DEF-brow.T.L.002', 'DEF-brow.T.L.003',
  'DEF-brow.B.L.002', 'DEF-brow.B.L.003',
];
const riggedRightInnerBrowBones = [
  'DEF-brow.T.R.002', 'DEF-brow.T.R.003',
  'DEF-brow.B.R.002', 'DEF-brow.B.R.003',
];
const riggedUpperLipBones = [
  'DEF-lip.T.L', 'DEF-lip.T.R', 'DEF-lip.T.L.001', 'DEF-lip.T.R.001',
];
const riggedLowerLipBones = [
  'DEF-lip.B.L', 'DEF-lip.B.R', 'DEF-lip.B.L.001', 'DEF-lip.B.R.001',
];
const riggedJawBones = [
  'DEF-jaw', 'DEF-jaw.L', 'DEF-jaw.L.001', 'DEF-jaw.R', 'DEF-jaw.R.001',
];
const riggedChinBones = [
  'DEF-chin', 'DEF-chin.001', 'DEF-chin.L', 'DEF-chin.R',
];
const riggedLowerMouthInteriorBones = [
  'DEF-teeth.B', 'DEF-tongue', 'DEF-tongue.001', 'DEF-tongue.002',
];
const riggedSyntheticFaceBones = [
  ...riggedSmileBones,
  ...riggedLeftLidBones,
  ...riggedRightLidBones,
  ...riggedLeftInnerBrowBones,
  ...riggedRightInnerBrowBones,
  ...riggedUpperLipBones,
  ...riggedLowerLipBones,
  ...riggedJawBones,
  ...riggedChinBones,
  ...riggedLowerMouthInteriorBones,
  'DEF-eye.L',
  'DEF-eye.R',
  'DEF-spine.005',
  'DEF-spine.006',
];
const riggedDetachedFaceBonePrefixes = [
  'DEF-brow.',
  'DEF-cheek.',
  'DEF-forehead.',
  'DEF-temple.',
  'DEF-ear.',
  'DEF-jaw',
  'DEF-chin',
  'DEF-tongue',
  'DEF-eye.',
  'DEF-lid.',
  'DEF-lip.',
  'DEF-nose',
  'DEF-teeth.',
];

function isDetachedFaceBoneName(name: string) {
  return riggedDetachedFaceBonePrefixes.some(prefix => name.startsWith(prefix));
}

const bodySegments: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
];
const visiblePoseLandmarks = new Set([11, 12, 13, 14, 15, 16, 23, 24]);
const maxFaceHorizontalDistance = 0.12;
const maxFaceVerticalDistance = 0.18;
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
const lineGeometry = new THREE.BufferGeometry();
const linePositions = new Float32Array((segments.length + 1) * 6);
lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
const skeleton = new THREE.LineSegments(
  lineGeometry,
  // Bright cyan keeps the moving arms and fingers legible over the quiet
  // mannequin silhouette, especially when a hand rises near the face.
  new THREE.LineBasicMaterial({
    color: 0xa5fff9,
    linewidth: 2,
    // The reference motion is the foreground information. Keeping it out of
    // the depth buffer avoids fingers fading when they cross the torso.
    depthTest: false,
    depthWrite: false,
  }),
);
scene.add(skeleton);
skeleton.renderOrder = 10;

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
    depthWrite: false,
  }),
);
scene.add(joints);
joints.renderOrder = 11;

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
    depthWrite: false,
  }),
);
scene.add(facePoints);
facePoints.renderOrder = 11;

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
    depthWrite: false,
  }),
);
scene.add(expressionPoints);
expressionPoints.renderOrder = 12;

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
  new THREE.MeshBasicMaterial({
    // The torso is only a positional guide. It must never compete with a
    // hand drawn over it, so keep it faint and out of depth testing.
    color: 0x202a38,
    transparent: true,
    opacity: 0.22,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
scene.add(torso);
torso.renderOrder = 0;

// Rounded articulated sections make the silhouette read as a person while
// the thin landmark skeleton remains available for the exact motion.
const mannequinSegments: Array<[number, number, number]> = [
  [11, 13, 0.15], [13, 15, 0.12], [12, 14, 0.15], [14, 16, 0.12],
];
const limbMaterial = new THREE.MeshBasicMaterial({
  // MeshBasicMaterial is intentionally used so the limbs remain illuminated
  // consistently on Android WebView, independent of device lighting.
  color: 0x6f9abc,
  transparent: true,
  opacity: 1,
  depthWrite: false,
  depthTest: false,
});
const limbCapsules = mannequinSegments.map(() => {
  // The unscaled capsule is two world units tall: a central section of one
  // and two round caps. It is scaled per captured shoulder/elbow/wrist pair.
  const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 12), limbMaterial);
  capsule.renderOrder = 5;
  scene.add(capsule);
  return capsule;
});
const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 12), limbMaterial);
neck.renderOrder = 5;
scene.add(neck);

const cartoonOutlineMaterial = new THREE.MeshBasicMaterial({color: 0x092c42, depthTest: false, depthWrite: false});
const cartoonSkinMaterial = new THREE.MeshBasicMaterial({color: 0x68d9d5, depthTest: false, depthWrite: false});
type CartoonHandLayer = {
  group: THREE.Group;
  palm: THREE.Mesh;
  palmPositions: Float32Array;
  palmGeometry: THREE.BufferGeometry;
  outlines: THREE.Mesh[];
  segments: THREE.Mesh[];
};

// Both illustrated hands are independently generated from their own 21
// landmarks. They have no rig, pose solver, or smoothing layer of their own.
function createCartoonHandLayer(): CartoonHandLayer {
  const group = new THREE.Group();
  const palmGeometry = new THREE.BufferGeometry();
  const palmPositions = new Float32Array(6 * 3);
  palmGeometry.setAttribute('position', new THREE.BufferAttribute(palmPositions, 3));
  palmGeometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
  const palm = new THREE.Mesh(
    palmGeometry,
    new THREE.MeshBasicMaterial({color: 0xF3B579, side: THREE.DoubleSide, depthTest: false, depthWrite: false}),
  );
  group.add(palm);
  const outlines = Array.from({length: 20}, () => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 10), cartoonOutlineMaterial);
    group.add(mesh);
    return mesh;
  });
  const segments = Array.from({length: 20}, () => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 10), cartoonSkinMaterial);
    group.add(mesh);
    return mesh;
  });
  group.visible = false;
  scene.add(group);
  return {group, palm, palmPositions, palmGeometry, outlines, segments};
}

const cartoonHands = new Map<number, CartoonHandLayer>([
  [33, createCartoonHandLayer()],
  [54, createCartoonHandLayer()],
]);

type CartoonBodyLayer = {
  group: THREE.Group;
  torso: THREE.Mesh;
  torsoPositions: Float32Array;
  torsoGeometry: THREE.BufferGeometry;
  torsoOutline: THREE.LineLoop;
  torsoOutlineGeometry: THREE.BufferGeometry;
  sleeves: THREE.Mesh[];
  sleeveOutlines: THREE.Mesh[];
};

function createCartoonBodyLayer(): CartoonBodyLayer {
  const group = new THREE.Group();
  const torsoGeometry = new THREE.BufferGeometry();
  const torsoPositions = new Float32Array(4 * 3);
  torsoGeometry.setAttribute('position', new THREE.BufferAttribute(torsoPositions, 3));
  torsoGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  const torso = new THREE.Mesh(torsoGeometry, new THREE.MeshBasicMaterial({
    color: 0x164953, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  }));
  group.add(torso);
  const torsoOutlineGeometry = new THREE.BufferGeometry();
  torsoOutlineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
  const torsoOutline = new THREE.LineLoop(torsoOutlineGeometry, new THREE.LineBasicMaterial({
    color: 0x0b2831, depthTest: false, depthWrite: false,
  }));
  group.add(torsoOutline);
  const sleeveOutlines = Array.from({length: 4}, () => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 10), new THREE.MeshBasicMaterial({
      color: 0x0b2831, depthTest: false, depthWrite: false,
    }));
    group.add(mesh);
    return mesh;
  });
  const sleeves = Array.from({length: 4}, () => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 10), new THREE.MeshBasicMaterial({
      color: 0x1d6370, depthTest: false, depthWrite: false,
    }));
    group.add(mesh);
    return mesh;
  });
  group.visible = false;
  scene.add(group);
  return {group, torso, torsoPositions, torsoGeometry, torsoOutline, torsoOutlineGeometry, sleeves, sleeveOutlines};
}

const cartoonBody = createCartoonBodyLayer();

type CartoonFaceLayer = {
  group: THREE.Group;
  head: THREE.Mesh;
  neck: THREE.Mesh;
  ears: THREE.Mesh[];
  antennae: THREE.Mesh[];
  antennaTips: THREE.Mesh[];
  eyeWhites: THREE.Mesh[];
  pupils: THREE.Mesh[];
  nose: THREE.Mesh;
  mouth: THREE.Mesh;
  brows: THREE.Mesh[];
};

function createCartoonFaceLayer(): CartoonFaceLayer {
  const group = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({color: 0x68d9d5, depthTest: false, depthWrite: false}));
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 8, 12), new THREE.MeshBasicMaterial({color: 0x68d9d5, depthTest: false, depthWrite: false}));
  const ears = Array.from({length: 2}, () => new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({color: 0x53c4cf, depthTest: false, depthWrite: false})));
  const antennae = Array.from({length: 2}, () => new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 8, 12), new THREE.MeshBasicMaterial({color: 0x53c4cf, depthTest: false, depthWrite: false})));
  const antennaTips = Array.from({length: 2}, () => new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({color: 0xa4fff5, depthTest: false, depthWrite: false})));
  const eyeWhites = Array.from({length: 2}, () => new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({color: 0xf8fffb, depthTest: false, depthWrite: false})));
  const pupils = Array.from({length: 2}, () => new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({color: 0x092c42, depthTest: false, depthWrite: false})));
  const nose = new THREE.Mesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({color: 0x259dab, depthTest: false, depthWrite: false}));
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({color: 0x174967, depthTest: false, depthWrite: false}));
  const brows = Array.from({length: 2}, () => new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 6, 10), new THREE.MeshBasicMaterial({color: 0x174967, depthTest: false, depthWrite: false})));
  [neck, head, ...ears, ...antennae, ...antennaTips, ...eyeWhites, ...pupils, nose, mouth, ...brows].forEach(mesh => group.add(mesh));
  group.visible = false;
  scene.add(group);
  return {group, head, neck, ears, antennae, antennaTips, eyeWhites, pupils, nose, mouth, brows};
}

const cartoonFace = createCartoonFaceLayer();

const bodyJointGeometry = new THREE.BufferGeometry();
const bodyJointPositions = new Float32Array(8 * 3);
bodyJointGeometry.setAttribute('position', new THREE.BufferAttribute(bodyJointPositions, 3));
const bodyJoints = new THREE.Points(
  bodyJointGeometry,
  new THREE.PointsMaterial({
    color: 0x6be3dc,
    size: 5.0,
    sizeAttenuation: true,
    depthTest: false,
    depthWrite: false,
  }),
);
scene.add(bodyJoints);
bodyJoints.renderOrder = 11;

const headFill = new THREE.Mesh(
  new THREE.CircleGeometry(1, 48),
  new THREE.MeshBasicMaterial({color: 0x3b5266, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide}),
);
scene.add(headFill);
headFill.renderOrder = 0;

const motions = new Map<ClipName, Motion>();
const motionLoads = new Map<ClipName, Promise<Motion>>();
const motionCacheOrder: ClipName[] = [];
// A decoded motion contains thousands of nested JavaScript arrays. Keeping the
// complete published library resident can make iOS terminate WKWebView's
// graphics process while native speech recognition remains alive. Load signs
// on demand and retain only the most recently used motions.
const MAX_CACHED_MOTIONS = 12;
const RETURN_TO_REST_SECONDS = 0.42;
const SIGN_TRANSITION_SECONDS = 0.18;
// Captures may be trimmed to only their active frames. Keep every published
// sign visible long enough to be perceived instead of flashing back to rest.
const MIN_SIGN_PLAYBACK_SECONDS = 1.35;
const singleHandedRigSides = new WeakMap<Motion, 'L' | 'R'>();
const stableRiggedHandMotions = new WeakSet<Motion>();
const softCurlRiggedHandMotions = new WeakSet<Motion>();
const fistRiggedHandMotions = new WeakSet<Motion>();
const pointingRiggedHandMotions = new WeakSet<Motion>();
const anatomicalRiggedHandMotions = new WeakSet<Motion>();
const stableRiggedFrames = new WeakMap<MotionFrame, MotionFrame>();
const avatarProfiles = new Map<ClipName, AvatarProfile>();
let activeMotion: Motion | undefined;
let activeProfile: AvatarProfile | undefined;
let activeRiggedHand: 'L' | 'R' | undefined;
let activeStableRiggedHandShape = false;
let activeSoftCurlRiggedHandShape = false;
let activeFistRiggedHandShape = false;
let activePointingRiggedHandShape = false;
let activeAnatomicalRiggedHandShape = false;
let activeRiggedHandPresentations: Partial<Record<'L' | 'R', RiggedHandPresentation>> = {};
let activeFrameIndex = -1;
let activePlaybackId = 0;
let activePlaybackSpeed = 1;
let activeStartedAt = 0;
let playbackPaused = false;
let playbackPausedAt = 0;
let activeStartFrame = 0;
let activeEndFrame = 0;
let lastFrame = -1;
let ended = false;
let displayedFrame: MotionFrame | undefined;
let returnStart: MotionFrame | undefined;
let returnTarget: MotionFrame | undefined;
let returnStartedAt = 0;
let returnDurationSeconds = RETURN_TO_REST_SECONDS;
let activeArmBindings: ArmBinding[] | undefined;
let activeRestReference: MotionFrame | undefined;
let activeFaceReference: Point[] | undefined;
let activeFaceCalibration: CapturedFaceCalibration | undefined;
// Captured fingers are meaningful while a sign is playing. Once the avatar is
// at rest, use the shared neutral silhouette instead of retaining a random
// palm orientation from the last captured frame.
let showCapturedHands = true;
// The procedural neutral landmarks keep the point and cartoon modes useful,
// but the rigged character should use its authored relaxed hand rotations
// while no captured sign is playing.
let riggedHandsAtRest = true;
let transitionStart: MotionFrame | undefined;
let transitionTarget: MotionFrame | undefined;
let transitionStartedAt = 0;
let transitionDurationSeconds = SIGN_TRANSITION_SECONDS;
let pendingMotion: Motion | undefined;
let pendingMotionStartFrame = 0;
let pendingMotionEndFrame = 0;
// Start in the production presentation mode. React Native may inject its
// preference after WebView startup, so this prevents an initial point-only
// flash before the first idle frame is drawn.
let renderMode: RenderMode = 'rigged';
let frontCartoonHandStart = 54;

function motionAssetName(clip: string): string {
  const normalized = clip.trim().toLowerCase();
  if (!normalized) throw new Error(`No se pudo crear el nombre del archivo para ${clip}.`);
  return `m_${Array.from(normalized, character =>
    character.codePointAt(0)!.toString(16).padStart(6, '0'),
  ).join('')}`;
}

function send(type: string, detail: Record<string, unknown> = {}) {
  window.ReactNativeWebView?.postMessage(JSON.stringify({type, ...detail}));
}

function valid(point: Point | undefined): point is Point {
  return point != null && point.some(value => Math.abs(value) > 1e-8);
}

window.setVozualRenderMode = (mode: RenderMode) => {
  renderMode = mode === 'hybrid' || mode === 'cartoon' || mode === 'rigged' ? mode : 'points';
  if (displayedFrame) setFrame(displayedFrame);
  // An idle Android WebView can retain the previous WebGL buffer even after
  // object visibility changes. Present the selected mode synchronously.
  renderer.render(scene, camera);
};

function receiveNativeCommand(event: Event) {
  const rawData = (event as MessageEvent).data;
  if (typeof rawData !== 'string') return;
  try {
    const command = JSON.parse(rawData) as {type?: unknown; mode?: unknown};
    if (command.type === 'set-render-mode' && typeof command.mode === 'string') {
      window.setVozualRenderMode(command.mode as RenderMode);
    }
  } catch {
    // Ignore unrelated WebView messages. The avatar runtime only accepts the
    // small command schema above.
  }
}

// React Native WebView dispatches Android messages on document; other WebView
// versions use window. Supporting both keeps the selector immediate across
// the Android versions used by VOZUAL.
document.addEventListener('message', receiveNativeCommand);
window.addEventListener('message', receiveNativeCommand);

function shouldDrawRiggedAvatar() {
  return (renderMode === 'rigged' || renderMode === 'hybrid')
    && riggedAvatar != null
    && riggedAligned;
}

function shouldDrawCartoonAvatar() {
  return renderMode === 'cartoon' || (renderMode === 'rigged' && riggedAvatar == null);
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

function placeCartoonCapsule(mesh: THREE.Mesh, from: THREE.Vector3 | undefined, to: THREE.Vector3 | undefined, thickness: number, depth: number) {
  if (!from || !to) {
    mesh.visible = false;
    return;
  }
  const direction = to.clone().sub(from);
  const length = direction.length();
  if (length < 0.0001) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.position.z = depth;
  mesh.rotation.set(0, 0, -Math.atan2(direction.x, direction.y));
  // CapsuleGeometry is two units high before scaling, including its round caps.
  mesh.scale.set(thickness, length / 2, thickness);
}

function chooseFrontCartoonHandForFrame(frame: MotionFrame): 33 | 54 {
  const first = frame.bodyHands.slice(33, 54) as CartoonHandPoint[];
  const second = frame.bodyHands.slice(54, 75) as CartoonHandPoint[];
  return chooseFrontCartoonHand(first, second, frontCartoonHandStart as 33 | 54);
}

function setCartoonLayerOrder(layer: CartoonHandLayer, baseOrder: number) {
  layer.palm.renderOrder = baseOrder;
  layer.outlines.forEach(mesh => { mesh.renderOrder = baseOrder + 1; });
  layer.segments.forEach(mesh => { mesh.renderOrder = baseOrder + 2; });
}

function updateCartoonHand(frame: MotionFrame, handStart: number, baseOrder: number) {
  const layer = cartoonHands.get(handStart);
  if (!layer) return;
  if (renderMode === 'points' || shouldDrawRiggedAvatar()) {
    layer.group.visible = false;
    return;
  }
  const captured = frame.bodyHands.slice(handStart, handStart + 21) as CartoonHandPoint[];
  const geometry = buildCartoonHandGeometry(captured);
  layer.group.visible = geometry.segments.length > 0;
  setCartoonLayerOrder(layer, baseOrder);

  if (geometry.palm.length === 6) {
    geometry.palm.forEach((index, vertex) => {
      const point = world(captured[index]);
      layer.palmPositions[vertex * 3] = point.x;
      layer.palmPositions[vertex * 3 + 1] = point.y;
      layer.palmPositions[vertex * 3 + 2] = 0.025;
    });
    layer.palm.visible = true;
    layer.palmGeometry.attributes.position.needsUpdate = true;
  } else {
    layer.palm.visible = false;
  }

  geometry.segments.forEach((segment, index) => {
    const from = world(captured[segment.from]);
    const to = world(captured[segment.to]);
    placeCartoonCapsule(layer.outlines[index], from, to, 0.070, 0.045);
    placeCartoonCapsule(layer.segments[index], from, to, 0.053, 0.055);
  });
  for (let index = geometry.segments.length; index < layer.segments.length; index += 1) {
    layer.outlines[index].visible = false;
    layer.segments[index].visible = false;
  }
}

function updateCartoonHands(frame: MotionFrame) {
  frontCartoonHandStart = chooseFrontCartoonHandForFrame(frame);
  const rearHandStart = frontCartoonHandStart === 33 ? 54 : 33;
  updateCartoonHand(frame, rearHandStart, 6);
  updateCartoonHand(frame, frontCartoonHandStart, 8);
}

function updateCartoonBody(frame: MotionFrame) {
  if (renderMode === 'points' || shouldDrawRiggedAvatar()) {
    cartoonBody.group.visible = false;
    return;
  }
  const geometry = buildCartoonBodyGeometry(frame.bodyHands as CartoonHandPoint[]);
  cartoonBody.group.visible = geometry.torso.length > 0 || geometry.armSegments.length > 0;
  if (geometry.torso.length === 4) {
    geometry.torso.forEach((index, vertex) => {
      const point = world(frame.bodyHands[index]);
      cartoonBody.torsoPositions[vertex * 3] = point.x;
      cartoonBody.torsoPositions[vertex * 3 + 1] = point.y;
      cartoonBody.torsoPositions[vertex * 3 + 2] = -0.02;
      const outlinePositions = cartoonBody.torsoOutlineGeometry.attributes.position.array as Float32Array;
      outlinePositions[vertex * 3] = point.x;
      outlinePositions[vertex * 3 + 1] = point.y;
      outlinePositions[vertex * 3 + 2] = 0;
    });
    cartoonBody.torso.visible = true;
    cartoonBody.torsoOutline.visible = true;
    cartoonBody.torso.renderOrder = 1;
    cartoonBody.torsoOutline.renderOrder = 2;
    cartoonBody.torsoGeometry.attributes.position.needsUpdate = true;
    cartoonBody.torsoOutlineGeometry.attributes.position.needsUpdate = true;
  } else {
    cartoonBody.torso.visible = false;
    cartoonBody.torsoOutline.visible = false;
  }
  geometry.armSegments.forEach((segment, index) => {
    const from = world(frame.bodyHands[segment.from]);
    const to = world(frame.bodyHands[segment.to]);
    placeCartoonCapsule(cartoonBody.sleeveOutlines[index], from, to, index % 2 === 0 ? 0.18 : 0.145, 0.015);
    placeCartoonCapsule(cartoonBody.sleeves[index], from, to, index % 2 === 0 ? 0.145 : 0.115, 0.025);
    cartoonBody.sleeveOutlines[index].renderOrder = 3;
    cartoonBody.sleeves[index].renderOrder = 4;
  });
  for (let index = geometry.armSegments.length; index < cartoonBody.sleeves.length; index += 1) {
    cartoonBody.sleeveOutlines[index].visible = false;
    cartoonBody.sleeves[index].visible = false;
  }
}

function placeCartoonCircle(mesh: THREE.Mesh, center: THREE.Vector3, radiusX: number, radiusY: number, order: number, depth: number) {
  mesh.visible = radiusX > 0.0001 && radiusY > 0.0001;
  if (!mesh.visible) return;
  mesh.position.copy(center);
  mesh.position.z = depth;
  mesh.scale.set(radiusX, radiusY, 1);
  mesh.renderOrder = order;
}

function updateCartoonFace(frame: MotionFrame, project: (source: Point) => THREE.Vector3, anchor: Point | undefined) {
  if (renderMode === 'points' || shouldDrawRiggedAvatar() || !anchor) {
    cartoonFace.group.visible = false;
    return;
  }
  const geometry = buildCartoonFaceGeometry(frame.face as CartoonHandPoint[]);
  if (!geometry) {
    cartoonFace.group.visible = false;
    return;
  }
  const requiredFeatures = [geometry.forehead, geometry.chin, geometry.leftEye, geometry.rightEye, geometry.nose, geometry.mouthCenter];
  if (!requiredFeatures.every(point => renderableFacePoint(point, anchor))) {
    cartoonFace.group.visible = false;
    return;
  }
  const forehead = project(geometry.forehead);
  const chin = project(geometry.chin);
  const leftEye = project(geometry.leftEye);
  const rightEye = project(geometry.rightEye);
  const center = forehead.clone().add(chin).multiplyScalar(0.5);
  const verticalAxis = chin.clone().sub(forehead);
  const radiusX = Math.max(0.03, leftEye.distanceTo(rightEye) * 1.18);
  // The detected forehead-to-chin span is often stretched by a phone camera.
  // Bound only the decorative silhouette; all facial landmarks still keep
  // their exact projected positions in hybrid mode.
  const radiusY = Math.min(verticalAxis.length() * 0.48, radiusX * 1.38);
  cartoonFace.group.visible = radiusY > 0.0001;
  placeCartoonCircle(cartoonFace.head, center, radiusX, radiusY, 5, 0.03);
  cartoonFace.head.rotation.z = Math.atan2(verticalAxis.y, verticalAxis.x) - Math.PI / 2;
  const faceDown = verticalAxis.normalize();
  const faceUp = faceDown.clone().multiplyScalar(-1);
  const faceSide = new THREE.Vector3(-faceDown.y, faceDown.x, 0).normalize();
  const ears = [1, -1];
  ears.forEach((side, index) => {
    const ear = center.clone().add(faceSide.clone().multiplyScalar(side * radiusX * 1.04));
    placeCartoonCircle(cartoonFace.ears[index], ear, radiusX * 0.28, radiusY * 0.26, 5, 0.028);
    cartoonFace.ears[index].rotation.z = cartoonFace.head.rotation.z;
    const antennaBase = center
      .clone()
      .add(faceSide.clone().multiplyScalar(side * radiusX * 0.36))
      .add(faceUp.clone().multiplyScalar(radiusY * 0.78));
    const antennaTip = antennaBase
      .clone()
      .add(faceSide.clone().multiplyScalar(side * radiusX * 0.24))
      .add(faceUp.clone().multiplyScalar(radiusY * 0.60));
    placeCartoonCapsule(cartoonFace.antennae[index], antennaBase, antennaTip, Math.max(0.018, radiusX * 0.12), 0.04);
    cartoonFace.antennae[index].renderOrder = 6;
    placeCartoonCircle(cartoonFace.antennaTips[index], antennaTip, radiusX * 0.16, radiusX * 0.16, 7, 0.05);
  });
  const leftShoulder = frame.bodyHands[11];
  const rightShoulder = frame.bodyHands[12];
  if (valid(leftShoulder) && valid(rightShoulder)) {
    const shoulderCenter = world(leftShoulder).add(world(rightShoulder)).multiplyScalar(0.5);
    placeCartoonCapsule(cartoonFace.neck, shoulderCenter, chin, Math.max(0.08, radiusX * 0.5), 0.02);
    cartoonFace.neck.renderOrder = 4;
  } else {
    cartoonFace.neck.visible = false;
  }
  const leftEyeWidth = Math.max(0.018, project([geometry.leftEye[0] + geometry.leftEyeWidth / 2, geometry.leftEye[1], geometry.leftEye[2]]).distanceTo(leftEye) * 1.5);
  const rightEyeWidth = Math.max(0.018, project([geometry.rightEye[0] + geometry.rightEyeWidth / 2, geometry.rightEye[1], geometry.rightEye[2]]).distanceTo(rightEye) * 1.5);
  const leftEyeHeight = Math.max(0.004, project([geometry.leftEye[0], geometry.leftEye[1] + geometry.leftEyeOpening / 2, geometry.leftEye[2]]).distanceTo(leftEye) * 1.6);
  const rightEyeHeight = Math.max(0.004, project([geometry.rightEye[0], geometry.rightEye[1] + geometry.rightEyeOpening / 2, geometry.rightEye[2]]).distanceTo(rightEye) * 1.6);
  const eyeWhites = [leftEye, rightEye];
  const eyeWidths = [leftEyeWidth, rightEyeWidth];
  const eyeHeights = [leftEyeHeight, rightEyeHeight];
  eyeWhites.forEach((eye, index) => {
    placeCartoonCircle(cartoonFace.eyeWhites[index], eye, eyeWidths[index], eyeHeights[index], 7, 0.04);
    placeCartoonCircle(
      cartoonFace.pupils[index],
      eye,
      Math.min(eyeWidths[index] * 0.48, Math.max(0.003, eyeHeights[index] * 0.74)),
      Math.max(0.003, eyeHeights[index] * 0.74),
      8,
      0.05,
    );
  });
  placeCartoonCircle(cartoonFace.nose, project(geometry.nose), Math.max(0.008, radiusX * 0.07), Math.max(0.006, radiusY * 0.045), 7, 0.04);
  const mouthLeft = project(geometry.mouthLeft);
  const mouthRight = project(geometry.mouthRight);
  const mouthUpper = project(geometry.mouthUpper);
  const mouthLower = project(geometry.mouthLower);
  const mouthCenter = project(geometry.mouthCenter);
  const mouthWidth = Math.max(0.008, mouthLeft.distanceTo(mouthRight) / 2);
  const mouthHeight = Math.max(0.006, mouthUpper.distanceTo(mouthLower) / 2);
  placeCartoonCircle(cartoonFace.mouth, mouthCenter, mouthWidth, mouthHeight, 7, 0.05);
  const brows: Array<[CartoonHandPoint, CartoonHandPoint]> = [geometry.leftBrow, geometry.rightBrow];
  brows.forEach(([from, to], index) => {
    placeCartoonCapsule(cartoonFace.brows[index], project(from), project(to), Math.max(0.01, radiusX * 0.045), 0.045);
    cartoonFace.brows[index].renderOrder = 7;
  });
}

function riggedBone(name: string): THREE.Bone | undefined {
  // GLTFLoader sanitizes dots, colons and slashes in node names so animation
  // paths remain valid. Keep Blender's readable Rigify names in the mapping
  // code and resolve their imported Three.js form here.
  return riggedBones.get(name)
    ?? riggedBones.get(name.replace(/[\[\].:/]/g, ''))
    ?? riggedBones.get(name.replace(/[\[\].:/]/g, '_'));
}

function riggedTargetPoint(point: Point) {
  const target = world(point);
  // Keep the rig on the same capture plane as the diagnostic landmarks.
  // Artificial per-joint depth shortens the arm in the orthographic screen
  // projection: part of its fixed length is spent along Z, so a captured
  // wrist that touches the face can stop visibly short of it. Existing
  // recordings do not contain a shared, calibrated Z space for Pose and
  // Hands, therefore X/Y are the fidelity source for this 2D presentation.
  target.z = 0;
  return target;
}

function riggedHandTargetPoint(
  side: 'L' | 'R',
  point: Point,
  wrist: Point,
  wristWorldZ: number,
) {
  const target = riggedTargetPoint(point);
  // Hand landmark depth is internally consistent even though it cannot be
  // mixed directly with Pose depth. Anchor it to the solved wrist and use
  // only the relative value inside this hand. This preserves an edge-on palm
  // instead of flattening its MCP joints into an ambiguous 2D line.
  const profileDepthScale = side === 'L'
    ? activeProfile?.rigLeftHandDepthScale
    : activeProfile?.rigRightHandDepthScale;
  const depthScale = THREE.MathUtils.clamp(profileDepthScale ?? 3.1, 0.5, 9);
  target.z = wristWorldZ - (point[2] - wrist[2]) * depthScale;
  return target;
}

function alignRiggedAvatar(bodyHands: Point[]) {
  if (!riggedAvatar || riggedAligned) return;
  const left = bodyHands[11];
  const right = bodyHands[12];
  const leftShoulder = riggedBone('DEF-upper_arm.L');
  const rightShoulder = riggedBone('DEF-upper_arm.R');
  if (!valid(left) || !valid(right) || !leftShoulder || !rightShoulder) return;

  riggedAvatar.updateMatrixWorld(true);
  const modelLeft = leftShoulder.getWorldPosition(new THREE.Vector3());
  const modelRight = rightShoulder.getWorldPosition(new THREE.Vector3());
  const targetLeft = world(left);
  const targetRight = world(right);
  const scale = THREE.MathUtils.clamp(
    targetLeft.distanceTo(targetRight) / Math.max(0.001, modelLeft.distanceTo(modelRight)),
    1.5,
    6,
  );
  riggedAvatar.scale.setScalar(scale);
  riggedAvatar.updateMatrixWorld(true);
  const scaledCenter = leftShoulder.getWorldPosition(new THREE.Vector3())
    .add(rightShoulder.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  const targetCenter = targetLeft.clone().add(targetRight).multiplyScalar(0.5);
  riggedAvatar.position.add(targetCenter.sub(scaledCenter));
  riggedAvatar.position.y += riggedVerticalAdjustment;
  riggedAvatar.updateMatrixWorld(true);

  riggedBones.forEach((bone, name) => {
    const origin = bone.getWorldPosition(new THREE.Vector3());
    // Rigify can place auxiliary deform children at exactly the same origin
    // as their parent. Selecting the first child makes the segment length
    // zero and silently disables retargeting for that joint. Use the farthest
    // direct bone child so the stored axis follows the actual deform chain.
    const childEndpoint = bone.children
      .filter(item => item instanceof THREE.Bone)
      .map(item => item.getWorldPosition(new THREE.Vector3()))
      .sort((first, second) => second.distanceToSquared(origin) - first.distanceToSquared(origin))[0];
    const endpoint = childEndpoint && childEndpoint.distanceToSquared(origin) >= 0.000001
      ? childEndpoint
      : bone.parent instanceof THREE.Bone
        ? origin.clone().add(origin.clone().sub(bone.parent.getWorldPosition(new THREE.Vector3())))
        : origin.clone().add(new THREE.Vector3(0, 0.01, 0));
    const localEndpoint = bone.worldToLocal(endpoint.clone());
    const direction = endpoint.clone().sub(origin);
    if (direction.lengthSq() < 0.000001) return;
    const quaternion = bone.getWorldQuaternion(new THREE.Quaternion());
    const localDirection = direction.clone().normalize().applyQuaternion(quaternion.clone().invert());
    const lengthAxis = Math.abs(localDirection.x) >= Math.abs(localDirection.y)
      ? Math.abs(localDirection.x) >= Math.abs(localDirection.z) ? 'x' : 'z'
      : Math.abs(localDirection.y) >= Math.abs(localDirection.z) ? 'y' : 'z';
    riggedBoneRests.set(name, {
      direction: direction.clone().normalize(),
      quaternion,
      localQuaternion: bone.quaternion.clone(),
      localPosition: bone.position.clone(),
      localScale: bone.scale.clone(),
      localEndpoint,
      lengthAxis,
      length: direction.length(),
    });
  });

  (['L', 'R'] as const).forEach(side => {
    const upper = riggedBone(`DEF-upper_arm.${side}`);
    const forearm = riggedBone(`DEF-forearm.${side}`);
    const hand = riggedBone(`DEF-hand.${side}`);
    const middle = riggedBone(`DEF-f_middle.01.${side}`);
    if (!upper || !forearm || !hand || !middle) return;
    riggedArmLengths.set(side, {
      upper: upper.getWorldPosition(new THREE.Vector3()).distanceTo(forearm.getWorldPosition(new THREE.Vector3())),
      lower: forearm.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3())),
      hand: hand.getWorldPosition(new THREE.Vector3()).distanceTo(middle.getWorldPosition(new THREE.Vector3())),
    });
    const metacarpals = [
      riggedBone(`DEF-f_index.01.${side}`),
      middle,
      riggedBone(`DEF-f_ring.01.${side}`),
      riggedBone(`DEF-f_pinky.01.${side}`),
    ];
    if (metacarpals.some(value => !value)) return;
    const handOrigin = hand.getWorldPosition(new THREE.Vector3());
    const inverseHandQuaternion = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    const metacarpalPositions = metacarpals.map(value =>
      value!.getWorldPosition(new THREE.Vector3()),
    );
    riggedPalmRests.set(side, {
      localLongitudinal: averageRiggedPoints(metacarpalPositions)
        .sub(handOrigin)
        .applyQuaternion(inverseHandQuaternion),
      localLateral: averageRiggedPoints(metacarpalPositions.slice(2))
        .sub(averageRiggedPoints(metacarpalPositions.slice(0, 2)))
        .applyQuaternion(inverseHandQuaternion),
    });
  });
  riggedAligned = true;
}

function setRiggedLongitudinalScale(name: string, factor: number) {
  const bone = riggedBone(name);
  const rest = bone ? riggedBoneRests.get(bone.name) : undefined;
  if (!bone || !rest) return;
  bone.scale.copy(rest.localScale);
  bone.scale[rest.lengthAxis] = rest.localScale[rest.lengthAxis] * Math.max(1, factor);
  bone.updateMatrix();
  bone.updateWorldMatrix(false, true);
}

function riggedBoneEndpoint(name: string) {
  const bone = riggedBone(name);
  const rest = bone ? riggedBoneRests.get(bone.name) : undefined;
  if (!bone || !rest) return undefined;
  return bone.localToWorld(rest.localEndpoint.clone());
}

function palmBasis(longitudinal: THREE.Vector3, lateral: THREE.Vector3) {
  const yAxis = longitudinal.clone().normalize();
  const xAxis = lateral.clone().addScaledVector(yAxis, -lateral.dot(yAxis));
  if (xAxis.lengthSq() < 0.000001) return undefined;
  xAxis.normalize();
  const zAxis = xAxis.clone().cross(yAxis).normalize();
  return new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
}

function averageRiggedPoints(points: THREE.Vector3[]) {
  return points.reduce(
    (average, point) => average.add(point),
    new THREE.Vector3(),
  ).multiplyScalar(1 / points.length);
}

function placeRiggedPalm(
  side: 'L' | 'R',
  hand: Point[],
) {
  const bone = riggedBone(`DEF-hand.${side}`);
  const boneRest = bone ? riggedBoneRests.get(bone.name) : undefined;
  const palmRest = riggedPalmRests.get(side);
  if (!bone || !bone.parent || !boneRest || !palmRest) return;
  if (![0, 5, 9, 17].every(index => valid(hand[index]))) return;

  bone.scale.copy(boneRest.localScale);
  bone.updateMatrix();
  bone.updateWorldMatrix(false, true);

  const wristWorldZ = bone.getWorldPosition(new THREE.Vector3()).z;
  const targetWrist = riggedHandTargetPoint(side, hand[0], hand[0], wristWorldZ);
  const targetMetacarpals = [5, 9, 13, 17].map(index =>
    riggedHandTargetPoint(side, hand[index], hand[0], wristWorldZ),
  );
  const targetPalmCenter = averageRiggedPoints(targetMetacarpals);
  const targetIndexSide = averageRiggedPoints(targetMetacarpals.slice(0, 2));
  const targetPinkySide = averageRiggedPoints(targetMetacarpals.slice(2));
  const localBasis = palmBasis(palmRest.localLongitudinal, palmRest.localLateral);
  const targetBasis = palmBasis(
    targetPalmCenter.clone().sub(targetWrist),
    targetPinkySide.clone().sub(targetIndexSide),
  );
  if (!localBasis || !targetBasis) return;

  const setWorldQuaternion = (desired: THREE.Quaternion) => {
    const parentWorldQuaternion = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parentWorldQuaternion.invert().multiply(desired).normalize());
    bone.updateMatrix();
    bone.updateWorldMatrix(false, true);
  };
  const rotation = targetBasis.clone().multiply(localBasis.clone().invert());
  setWorldQuaternion(new THREE.Quaternion().setFromRotationMatrix(rotation));

  const modelMetacarpals = [
    riggedBone(`DEF-f_index.01.${side}`),
    riggedBone(`DEF-f_middle.01.${side}`),
    riggedBone(`DEF-f_ring.01.${side}`),
    riggedBone(`DEF-f_pinky.01.${side}`),
  ];
  if (modelMetacarpals.some(value => !value)) return;

  if (!activeStableRiggedHandShape) {
    const actualWrist = bone.getWorldPosition(new THREE.Vector3());
    const actualMetacarpals = modelMetacarpals.map(value =>
      value!.getWorldPosition(new THREE.Vector3()),
    );
    const actualPalmCenter = averageRiggedPoints(actualMetacarpals);
    const actualIndexSide = averageRiggedPoints(actualMetacarpals.slice(0, 2));
    const actualPinkySide = averageRiggedPoints(actualMetacarpals.slice(2));
    const actualLongitudinal = actualWrist.distanceTo(actualPalmCenter);
    const actualLateral = actualIndexSide.distanceTo(actualPinkySide);
    const targetLongitudinal = targetWrist.distanceTo(targetPalmCenter);
    const targetLateral = targetIndexSide.distanceTo(targetPinkySide);
    const sideMinimumScale = side === 'L'
      ? activeProfile?.rigLeftPalmScaleMin
      : activeProfile?.rigRightPalmScaleMin;
    const sideMaximumScale = side === 'L'
      ? activeProfile?.rigLeftPalmScaleMax
      : activeProfile?.rigRightPalmScaleMax;
    const scale = riggedPalmScaleFactor(
      targetLongitudinal,
      actualLongitudinal,
      targetLateral,
      actualLateral,
      activeFistRiggedHandShape,
      sideMinimumScale ?? activeProfile?.rigPalmScaleMin,
      sideMaximumScale ?? activeProfile?.rigPalmScaleMax,
    );
    bone.scale.copy(boneRest.localScale).multiplyScalar(scale);
    bone.updateMatrix();
    bone.updateWorldMatrix(false, true);
  }

  // A dynamically lengthened forearm gives the hand a non-uniform parent
  // transform. One absolute quaternion is not enough in that space: the
  // inherited scale can skew the visible palm after rotation. Refine against
  // the actual MCP positions so index-to-little and wrist-to-middle converge
  // to the same two screen axes as the captured hand.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const currentWrist = bone.getWorldPosition(new THREE.Vector3());
    const currentMetacarpals = modelMetacarpals.map(value =>
      value!.getWorldPosition(new THREE.Vector3()),
    );
    const currentPalmCenter = averageRiggedPoints(currentMetacarpals);
    const currentIndexSide = averageRiggedPoints(currentMetacarpals.slice(0, 2));
    const currentPinkySide = averageRiggedPoints(currentMetacarpals.slice(2));
    const currentBasis = palmBasis(
      currentPalmCenter.sub(currentWrist),
      currentPinkySide.sub(currentIndexSide),
    );
    if (!currentBasis) break;
    const correctionMatrix = targetBasis.clone().multiply(currentBasis.clone().invert());
    const correction = new THREE.Quaternion().setFromRotationMatrix(correctionMatrix);
    const currentWorldQuaternion = bone.getWorldQuaternion(new THREE.Quaternion());
    setWorldQuaternion(correction.multiply(currentWorldQuaternion).normalize());
  }
}

function targetAtRiggedLength(
  from: THREE.Vector3,
  screenTarget: THREE.Vector3,
  length: number,
  sourceFrom: Point,
  sourceTo: Point,
) {
  const target = screenTarget.clone();
  const projectedDistance = Math.hypot(target.x - from.x, target.y - from.y);
  const depthDistance = Math.sqrt(Math.max(0, length ** 2 - projectedDistance ** 2));
  // MediaPipe uses negative Z toward the camera, while Three's camera is on
  // positive Z. Depth only supplies the amount required by the fixed bone;
  // the captured X/Y positions remain exact on screen.
  const sourceDepthDelta = sourceTo[2] - sourceFrom[2];
  const depthSign = Math.abs(sourceDepthDelta) < 0.0001 ? 1 : -Math.sign(sourceDepthDelta);
  target.z = from.z + depthSign * depthDistance;
  return target;
}

function placeRiggedBoneBetween(
  name: string,
  from: THREE.Vector3,
  to: THREE.Vector3,
  _restLength?: number,
  _uniformScale = false,
) {
  const bone = riggedBone(name);
  const rest = bone ? riggedBoneRests.get(bone.name) : undefined;
  if (!bone || !bone.parent || !rest) return;
  const desiredDirection = to.clone().sub(from);
  if (desiredDirection.lengthSq() < 0.000001) return;

  // Solve every frame from the authored rest pose. Using the previous frame's
  // quaternion here accumulates roll around the bone axis and eventually
  // twists the skinned finger away from its landmark chain. A rest-based
  // swing is deterministic: the segment still follows the captured points,
  // while the model's original roll remains stable.
  const delta = new THREE.Quaternion().setFromUnitVectors(
    rest.direction,
    desiredDirection.normalize(),
  );
  const desiredWorldQuaternion = delta.multiply(rest.quaternion).normalize();
  const parentWorldQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const localQuaternion = parentWorldQuaternion.invert()
    .multiply(desiredWorldQuaternion)
    .normalize();

  bone.matrixAutoUpdate = true;
  bone.quaternion.copy(localQuaternion);
  bone.updateMatrix();
  bone.updateWorldMatrix(false, true);
}

function placeRiggedFingerBoneBetween(
  name: string,
  from: THREE.Vector3,
  to: THREE.Vector3,
) {
  const bone = riggedBone(name);
  const rest = bone ? riggedBoneRests.get(bone.name) : undefined;
  if (!bone || !bone.parent || !rest) return;
  const desiredDirection = to.clone().sub(from);
  if (desiredDirection.lengthSq() < 0.000001) return;

  // Hand bones are restored to their authored local pose before every frame
  // and solved from wrist to fingertip. Use the already-solved parent as the
  // roll reference for each child. Keeping a fixed world-space roll on every
  // phalanx counter-rotated children against their parents and produced the
  // thin, twisted "claw" silhouette seen in strongly flexed signs.
  bone.updateMatrix();
  bone.updateWorldMatrix(false, true);
  const actualFrom = bone.getWorldPosition(new THREE.Vector3());
  const actualEndpoint = riggedBoneEndpoint(name);
  const inheritedDirection = actualEndpoint?.sub(actualFrom);
  if (!inheritedDirection || inheritedDirection.lengthSq() < 0.000001) return;
  const inheritedWorldQuaternion = bone.getWorldQuaternion(new THREE.Quaternion());
  const swing = new THREE.Quaternion().setFromUnitVectors(
    inheritedDirection.normalize(),
    desiredDirection.normalize(),
  );
  const desiredWorldQuaternion = swing.multiply(inheritedWorldQuaternion).normalize();
  const parentWorldQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(
    parentWorldQuaternion.invert().multiply(desiredWorldQuaternion).normalize(),
  );
  bone.updateMatrix();
  bone.updateWorldMatrix(false, true);
}

function restoreRiggedHandPose(side: 'L' | 'R') {
  const handBoneNames = [
    `DEF-hand.${side}`,
    ...riggedFingerTargets.map(([boneName]) => `DEF-${boneName}.${side}`),
  ];
  handBoneNames.forEach(name => {
    const bone = riggedBone(name);
    const rest = bone ? riggedBoneRests.get(bone.name) : undefined;
    if (!bone || !rest) return;
    bone.quaternion.copy(rest.localQuaternion);
    bone.scale.copy(rest.localScale);
    bone.updateMatrix();
  });
  riggedAvatar?.updateMatrixWorld(true);
}

function restoreRiggedSyntheticFacePose() {
  riggedSyntheticFaceBones.forEach(name => {
    const bone = riggedBone(name);
    const rest = bone ? riggedBoneRests.get(bone.name) : undefined;
    if (!bone || !rest) return;
    bone.position.copy(rest.localPosition);
    bone.quaternion.copy(rest.localQuaternion);
    bone.scale.copy(rest.localScale);
    bone.updateMatrix();
  });
  riggedAvatar?.updateMatrixWorld(true);
}

function restoreRiggedIdleBodyPose() {
  if (!riggedAvatar) return;
  riggedAvatar.position.y -= riggedIdleRootVerticalOffset;
  riggedAvatar.rotation.z -= riggedIdleRootRotationZ;
  riggedAvatar.scale.divideScalar(riggedIdleRootScale);
  riggedIdleRootVerticalOffset = 0;
  riggedIdleRootRotationZ = 0;
  riggedIdleRootScale = 1;
  riggedAvatar.updateMatrixWorld(true);
}

function applyRiggedIdleBody(elapsedMs: number) {
  if (!riggedAvatar) return;
  restoreRiggedIdleBodyPose();
  const presentation = livelyIdleBodyPresentation(elapsedMs);
  riggedIdleRootVerticalOffset = presentation.verticalOffset;
  riggedIdleRootRotationZ = presentation.rotationZ;
  riggedIdleRootScale = presentation.scale;
  riggedAvatar.position.y += riggedIdleRootVerticalOffset;
  riggedAvatar.rotation.z += riggedIdleRootRotationZ;
  riggedAvatar.scale.multiplyScalar(riggedIdleRootScale);
  riggedAvatar.updateMatrixWorld(true);
}

function offsetRiggedBoneInWorld(name: string, offset: THREE.Vector3) {
  const bone = riggedBone(name);
  if (!bone?.parent) return;
  const targetWorld = bone.getWorldPosition(new THREE.Vector3()).add(offset);
  bone.position.copy(bone.parent.worldToLocal(targetWorld));
  bone.updateMatrix();
}

function rotateRiggedBoneInWorld(
  name: string,
  axis: THREE.Vector3,
  angle: number,
) {
  const bone = riggedBone(name);
  if (!bone?.parent || Math.abs(angle) < 0.000001) return;
  const worldRotation = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  const currentWorld = bone.getWorldQuaternion(new THREE.Quaternion());
  const desiredWorld = worldRotation.multiply(currentWorld).normalize();
  const parentWorld = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentWorld.invert().multiply(desiredWorld).normalize());
  bone.updateMatrix();
}

function rotateRiggedHeadAndFace(
  orientation: {yaw: number; pitch: number; roll: number},
) {
  const {neck, head} = splitCapturedHeadOrientation(orientation);
  // The repaired mobile GLB parents all facial deform bones to this head bone,
  // so a single skeletal rotation moves the skull, skin, eyes and mouth using
  // the same bind matrices. Runtime translations of individual facial roots
  // create a detached-mask effect and must never be used here.
  rotateRiggedBoneInWorld('DEF-spine.005', new THREE.Vector3(0, 1, 0), neck.yaw);
  rotateRiggedBoneInWorld('DEF-spine.005', new THREE.Vector3(1, 0, 0), neck.pitch);
  rotateRiggedBoneInWorld('DEF-spine.005', new THREE.Vector3(0, 0, 1), neck.roll);
  rotateRiggedBoneInWorld('DEF-spine.006', new THREE.Vector3(0, 1, 0), head.yaw);
  rotateRiggedBoneInWorld('DEF-spine.006', new THREE.Vector3(1, 0, 0), head.pitch);
  rotateRiggedBoneInWorld('DEF-spine.006', new THREE.Vector3(0, 0, 1), head.roll);
}

function closeRiggedEye(side: 'L' | 'R', intensity: number) {
  const top = side === 'L' ? riggedLeftLidBones.slice(0, 4) : riggedRightLidBones.slice(0, 4);
  const bottom = side === 'L' ? riggedLeftLidBones.slice(4) : riggedRightLidBones.slice(4);
  top.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(0, -0.115 * intensity, 0.004));
  });
  bottom.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(0, 0.075 * intensity, 0.004));
  });
}

function widenRiggedEye(side: 'L' | 'R', intensity: number) {
  const top = side === 'L' ? riggedLeftLidBones.slice(0, 4) : riggedRightLidBones.slice(0, 4);
  const bottom = side === 'L' ? riggedLeftLidBones.slice(4) : riggedRightLidBones.slice(4);
  top.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(0, 0.045 * intensity, 0));
  });
  bottom.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(0, -0.028 * intensity, 0));
  });
}

function applyCapturedRiggedFace(frame: MotionFrame) {
  if (!activeFaceReference) return;
  const presentation = capturedFacePresentation(
    frame.face,
    activeFaceReference,
    activeFaceCalibration,
  );
  if (!presentation) return;
  const headOrientation = frame.headOrientation ?? {
    yaw: presentation.headYaw,
    pitch: presentation.headPitch,
    roll: presentation.headRoll,
  };

  closeRiggedEye('L', presentation.leftEyeClosure);
  closeRiggedEye('R', presentation.rightEyeClosure);
  widenRiggedEye('L', presentation.leftEyeWidening);
  widenRiggedEye('R', presentation.rightEyeWidening);
  riggedUpperLipBones.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(
      0,
      0.035 * presentation.mouthOpening,
      0.006 * presentation.mouthPucker + 0.002,
    ));
  });
  riggedLowerLipBones.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(
      0,
      -0.055 * presentation.mouthOpening,
      0.006 * presentation.mouthPucker + 0.002,
    ));
  });
  riggedJawBones.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(0, -0.022 * presentation.mouthOpening, 0));
  });
  riggedChinBones.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(0, -0.018 * presentation.mouthOpening, 0));
  });
  riggedLowerMouthInteriorBones.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(0, -0.03 * presentation.mouthOpening, 0));
  });
  ['DEF-lip.T.L.001', 'DEF-lip.B.L.001'].forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(-0.04 * presentation.mouthPucker, 0, 0.016 * presentation.mouthPucker));
  });
  ['DEF-lip.T.R.001', 'DEF-lip.B.R.001'].forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(0.04 * presentation.mouthPucker, 0, 0.016 * presentation.mouthPucker));
  });
  ['DEF-lip.T.L.001', 'DEF-lip.B.L.001'].forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(
      0.014 * presentation.leftMouthCornerRaise,
      0.045 * (presentation.leftMouthCornerRaise - presentation.leftMouthCornerDrop),
      0,
    ));
  });
  ['DEF-lip.T.R.001', 'DEF-lip.B.R.001'].forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(
      -0.014 * presentation.rightMouthCornerRaise,
      0.045 * (presentation.rightMouthCornerRaise - presentation.rightMouthCornerDrop),
      0,
    ));
  });
  riggedLeftInnerBrowBones.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(
      0,
      0.035 * (presentation.leftInnerBrowLift - presentation.leftInnerBrowLower),
      0,
    ));
  });
  riggedRightInnerBrowBones.forEach(name => {
    offsetRiggedBoneInWorld(name, new THREE.Vector3(
      0,
      0.035 * (presentation.rightInnerBrowLift - presentation.rightInnerBrowLower),
      0,
    ));
  });
  rotateRiggedHeadAndFace(headOrientation);
}

function applyRiggedLivelyFace(frame?: MotionFrame) {
  restoreRiggedSyntheticFacePose();
  if (frame) applyCapturedRiggedFace(frame);
  const now = performance.now();
  const idle = riggedHandsAtRest
    && !activeMotion
    && !pendingMotion
    && !transitionStart
    && !returnStart
    ? livelyIdleFacePresentation(now)
    : undefined;
  if (idle) {
    const gaze = livelyIdleGazePresentation(now);
    rotateRiggedBoneInWorld('DEF-eye.L', new THREE.Vector3(0, 1, 0), gaze.eyeYaw);
    rotateRiggedBoneInWorld('DEF-eye.R', new THREE.Vector3(0, 1, 0), gaze.eyeYaw);
    rotateRiggedHeadAndFace({yaw: gaze.headYaw, pitch: 0, roll: gaze.headTilt});
  }
  const expression = idle?.expression;
  const intensity = idle?.intensity ?? 0;
  if (!expression || intensity <= 0) return;

  const vertical = 0.062 * intensity;
  const horizontal = 0.03 * intensity;
  const smilesLeft = expression === 'smile'
    || expression === 'smirk-left'
    || expression === 'wink-left'
    || expression === 'wink-right';
  const smilesRight = expression === 'smile'
    || expression === 'smirk-right'
    || expression === 'wink-left'
    || expression === 'wink-right';
  if (smilesLeft) {
    ['DEF-lip.T.L.001', 'DEF-lip.B.L.001', 'DEF-cheek.B.L'].forEach(name => {
      offsetRiggedBoneInWorld(name, new THREE.Vector3(horizontal, vertical, 0));
    });
  }
  if (smilesRight) {
    ['DEF-lip.T.R.001', 'DEF-lip.B.R.001', 'DEF-cheek.B.R'].forEach(name => {
      offsetRiggedBoneInWorld(name, new THREE.Vector3(-horizontal, vertical, 0));
    });
  }
  if (expression === 'blink' || expression === 'wink-left') closeRiggedEye('L', intensity);
  if (expression === 'blink' || expression === 'wink-right') closeRiggedEye('R', intensity);
  riggedAvatar?.updateMatrixWorld(true);
}

function profileContactAnchor(frame: MotionFrame): THREE.Vector3 | undefined {
  const anchor = activeProfile?.contactAnchor;
  if (anchor === 'chin' && valid(frame.face[152])) return riggedTargetPoint(frame.face[152]);
  if (anchor === 'forehead' && valid(frame.face[10])) return riggedTargetPoint(frame.face[10]);
  if (anchor === 'mouth' && valid(frame.face[13]) && valid(frame.face[14])) {
    return riggedTargetPoint([
      (frame.face[13][0] + frame.face[14][0]) / 2,
      (frame.face[13][1] + frame.face[14][1]) / 2,
      (frame.face[13][2] + frame.face[14][2]) / 2,
    ]);
  }
  return undefined;
}

function profileRiggedContactAnchor(frame: MotionFrame): THREE.Vector3 | undefined {
  if (!activeProfile?.rigContactUseAvatarAnchor) return profileContactAnchor(frame);
  if (activeProfile.contactAnchor === 'chin') {
    // Use the rendered character's chin after its captured head rotation has
    // been applied. Mapping MediaPipe face point 152 through the body mapper
    // places the contact too high on avatars with different facial
    // proportions, which makes chin contacts appear to touch the nose.
    return riggedBone('DEF-chin')?.getWorldPosition(new THREE.Vector3())
      ?? riggedBone('DEF-chin.001')?.getWorldPosition(new THREE.Vector3());
  }
  return profileContactAnchor(frame);
}

function applyProfileContactBias(
  side: 'L' | 'R',
  frame: MotionFrame,
  wristTarget: THREE.Vector3,
): THREE.Vector3 {
  const bias = activeProfile?.rigContactBias ?? 0;
  const contactStartFrame = activeProfile?.contactStartFrame ?? -1;
  const contactEndFrame = activeProfile?.contactEndFrame ?? -1;
  const profileSide = activeRiggedHand
    ?? (activeProfile?.activeHand === 'right' ? 'R' : activeProfile?.activeHand === 'left' ? 'L' : undefined);
  if (bias <= 0 || profileSide !== side) return wristTarget;
  const weight = contactPresentationWeight(
    activeFrameIndex,
    contactStartFrame,
    contactEndFrame,
  );
  if (weight <= 0) return wristTarget;
  const anchor = profileContactAnchor(frame);
  if (!anchor) return wristTarget;
  const direction = anchor.sub(wristTarget);
  const distance = direction.length();
  if (distance < 0.0001) return wristTarget;
  return wristTarget.clone().add(
    direction.normalize().multiplyScalar(Math.min(distance, bias * weight)),
  );
}

function profileContactWeight() {
  return contactPresentationWeight(
    activeFrameIndex,
    activeProfile?.contactStartFrame ?? -1,
    activeProfile?.contactEndFrame ?? -1,
  );
}

function riggedHandLandmarkWorld(
  side: 'L' | 'R',
  landmarkIndex: number,
): THREE.Vector3 | undefined {
  if (landmarkIndex === 0) {
    return riggedBone(`DEF-hand.${side}`)?.getWorldPosition(new THREE.Vector3());
  }
  const fingertipBones: Record<number, string> = {
    4: 'thumb.03',
    8: 'f_index.03',
    12: 'f_middle.03',
    16: 'f_ring.03',
    20: 'f_pinky.03',
  };
  const boneName = fingertipBones[landmarkIndex];
  return boneName ? riggedBoneEndpoint(`DEF-${boneName}.${side}`) : undefined;
}

const INDEX_ONLY_FINGER_CURLS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ['f_middle', [46, 56, 40]],
  ['f_ring', [48, 58, 42]],
  ['f_pinky', [50, 60, 44]],
];
const INDEX_ONLY_THUMB_CURL = [30, 45, 30] as const;

function applyRiggedIndexOnlyFist(side: 'L' | 'R') {
  const applyLocalRotation = (
    boneName: string,
    flexionDegrees: number,
    adductionDegrees = 0,
  ) => {
    const bone = riggedBone(boneName);
    const rest = bone ? riggedBoneRests.get(bone.name) : undefined;
    if (!bone || !rest) return;
    const poseRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(flexionDegrees),
      0,
      THREE.MathUtils.degToRad(adductionDegrees),
      'XYZ',
    ));
    bone.quaternion.copy(rest.localQuaternion).multiply(poseRotation).normalize();
    bone.scale.copy(rest.localScale);
    bone.updateMatrix();
    bone.updateWorldMatrix(false, true);
  };

  INDEX_ONLY_FINGER_CURLS.forEach(([fingerName, curls]) => {
    curls.forEach((curl, jointIndex) => {
      applyLocalRotation(`DEF-${fingerName}.0${jointIndex + 1}.${side}`, curl);
    });
  });
  // The GLB hand bases are mirrored after Blender's Z-up to Three.js Y-up
  // conversion. Adduct in the runtime-local direction so each thumb folds
  // toward the palm center instead of hanging outside the fist.
  const thumbAdduction = side === 'L' ? 34 : -34;
  INDEX_ONLY_THUMB_CURL.forEach((curl, jointIndex) => {
    applyLocalRotation(
      `DEF-thumb.0${jointIndex + 1}.${side}`,
      curl,
      jointIndex === 0 ? thumbAdduction : 0,
    );
  });
  riggedAvatar?.updateMatrixWorld(true);
}

function driveRiggedPalmAndFingers(
  side: 'L' | 'R',
  hand: Point[],
  handBone: THREE.Bone | undefined,
) {
  restoreRiggedHandPose(side);
  placeRiggedPalm(side, hand);
  riggedAvatar?.updateMatrixWorld(true);
  const palmWorldZ = handBone?.getWorldPosition(new THREE.Vector3()).z ?? 0;

  if (activeRiggedHandPresentations[side] === 'index-only') {
    applyRiggedIndexOnlyFist(side);
  }

  riggedFingerTargets.forEach(([boneName, fromIndex, toIndex]) => {
    if (
      (
        activeStableRiggedHandShape
        || activeRiggedHandPresentations[side] === 'open'
        || activeRiggedHandPresentations[side] === 'open-palm'
      )
      && !shouldDriveStableOpenHandSegment(fromIndex)
    ) return;
    if (activeRiggedHandPresentations[side] === 'index-only' && fromIndex !== 5) return;
    if (
      (
        activeRiggedHandPresentations[side] === 'pointing'
        || activeRiggedHandPresentations[side] === 'self-pointing'
      )
      && !shouldDrivePointingHandSegment(fromIndex)
    ) return;
    const from = hand[fromIndex];
    const to = hand[toIndex];
    if (!valid(from) || !valid(to)) return;
    const fullBoneName = `DEF-${boneName}.${side}`;
    const bone = riggedBone(fullBoneName);
    const rest = bone ? riggedBoneRests.get(bone.name) : undefined;
    if (!bone || !rest) return;

    bone.scale.copy(rest.localScale);
    bone.updateMatrix();
    bone.updateWorldMatrix(false, true);
    const actualFrom = bone.getWorldPosition(new THREE.Vector3());
    const endpoint = riggedBoneEndpoint(fullBoneName);
    const effectiveLength = endpoint?.distanceTo(actualFrom) ?? rest.length;
    const handRelativeDirection = riggedHandTargetPoint(side, to, hand[0], palmWorldZ)
      .sub(riggedHandTargetPoint(side, from, hand[0], palmWorldZ));
    if (handRelativeDirection.lengthSq() < 0.000001) return;
    const solvedEndpoint = actualFrom.clone().add(
      handRelativeDirection.normalize().multiplyScalar(effectiveLength),
    );
    placeRiggedFingerBoneBetween(fullBoneName, actualFrom, solvedEndpoint);
    riggedAvatar?.updateMatrixWorld(true);
  });
}

function driveRiggedHand(
  side: 'L' | 'R',
  frame: MotionFrame,
  binding: ArmBinding,
  driveCapturedHandPose: boolean,
) {
  const lengths = riggedArmLengths.get(side);
  const shoulder = frame.bodyHands[binding.shoulder];
  const elbow = frame.bodyHands[binding.elbow];
  const wrist = frame.bodyHands[binding.wrist];
  const hand = binding.handStart === undefined
    ? []
    : frame.bodyHands.slice(binding.handStart, binding.handStart + 21);
  if (!lengths || !valid(shoulder) || !valid(elbow) || !valid(wrist)) return;

  const elbowScreenTarget = riggedTargetPoint(elbow);
  // Hand landmark 0 and Pose wrist are estimated by different MediaPipe
  // models and can visibly disagree. The 21-point hand is the authoritative
  // source for the palm and fingers, so the forearm must finish at landmark 0.
  const capturedWrist = valid(hand[0]) ? hand[0] : wrist;
  const wristScreenTarget = applyProfileContactBias(
    side,
    frame,
    riggedTargetPoint(capturedWrist),
  );
  const upperBone = riggedBone(`DEF-upper_arm.${side}`);
  if (!upperBone) return;
  const actualShoulder = upperBone.getWorldPosition(new THREE.Vector3());
  const elbowTarget = targetAtRiggedLength(
    actualShoulder,
    elbowScreenTarget,
    lengths.upper,
    shoulder,
    elbow,
  );
  placeRiggedBoneBetween(`DEF-upper_arm.${side}`, actualShoulder, elbowTarget, lengths.upper);
  riggedAvatar?.updateMatrixWorld(true);

  const forearmBone = riggedBone(`DEF-forearm.${side}`);
  const handBone = riggedBone(`DEF-hand.${side}`);
  const actualElbow = forearmBone?.getWorldPosition(new THREE.Vector3()) ?? elbowTarget;
  const sideHandFrontDepth = side === 'L'
    ? activeProfile?.rigLeftHandFrontDepth
    : activeProfile?.rigRightHandFrontDepth;
  const minimumHandFrontDepth = Math.max(
    0,
    sideHandFrontDepth ?? activeProfile?.rigHandFrontDepth ?? 0,
  );
  // A crossed fist can project onto the torso even when its captured X/Y is
  // exact. Reserve enough forearm length in depth to keep that hand in front
  // of the clothing without changing its on-screen trajectory.
  const projectedForearmDistance = Math.hypot(
    wristScreenTarget.x - actualElbow.x,
    wristScreenTarget.y - actualElbow.y,
  );
  const requiredForearmLength = Math.max(
    activeRiggedForearmLengths.get(side) ?? lengths.lower,
    Math.hypot(projectedForearmDistance, minimumHandFrontDepth),
  );
  setRiggedLongitudinalScale(
    `DEF-forearm.${side}`,
    requiredForearmLength / Math.max(0.0001, lengths.lower),
  );
  riggedAvatar?.updateMatrixWorld(true);
  const effectiveForearmLength = forearmBone && handBone
    ? forearmBone.getWorldPosition(new THREE.Vector3())
      .distanceTo(handBone.getWorldPosition(new THREE.Vector3()))
    : lengths.lower;
  const wristTarget = targetAtRiggedLength(
    actualElbow,
    wristScreenTarget,
    effectiveForearmLength,
    elbow,
    capturedWrist,
  );
  // The same captured X/Y wrist admits two depth solutions for a fixed-length
  // forearm. LSC hands normally act in front of the torso; choosing the rear
  // branch lets the body occlude otherwise correct fingers during crossings.
  wristTarget.z = actualElbow.z + Math.abs(wristTarget.z - actualElbow.z);
  placeRiggedBoneBetween(`DEF-forearm.${side}`, actualElbow, wristTarget, effectiveForearmLength);
  riggedAvatar?.updateMatrixWorld(true);

  if (!driveCapturedHandPose || !valid(hand[0])) {
    restoreRiggedHandPose(side);
    return;
  }

  // Start from the authored pose every frame, then solve the palm with two
  // independent axes. Wrist-to-middle alone cannot determine palm roll and
  // was able to mirror the visual order of index and little fingers.
  driveRiggedPalmAndFingers(side, hand, handBone);

  const contactLandmark = activeProfile?.rigContactLandmark;
  const contactSnap = THREE.MathUtils.clamp(activeProfile?.rigContactSnap ?? 0, 0, 1);
  const contactWeight = profileContactWeight();
  const anchor = profileRiggedContactAnchor(frame);
  const actualContact = contactLandmark === undefined
    ? undefined
    : riggedHandLandmarkWorld(side, contactLandmark);
  if (
    contactSnap <= 0
    || contactWeight <= 0
    || !anchor
    || !actualContact
    || (activeRiggedHand !== undefined && activeRiggedHand !== side)
  ) return;

  // Actor and avatar hand proportions are different. Following only the
  // captured wrist can therefore place an otherwise correct fingertip above
  // the authored face contact. Re-solve the forearm from the rendered contact
  // error; source landmarks, frames and timing remain unchanged.
  const correction = anchor.sub(actualContact);
  correction.z = 0;
  correction.multiplyScalar(contactSnap * contactWeight);
  if (correction.lengthSq() < 0.000001) return;
  correction.clampLength(0, 0.42);
  const correctedWristScreenTarget = wristScreenTarget.clone().add(correction);
  const correctedProjectedDistance = Math.hypot(
    correctedWristScreenTarget.x - actualElbow.x,
    correctedWristScreenTarget.y - actualElbow.y,
  );
  const correctedForearmLength = Math.max(
    lengths.lower,
    Math.hypot(correctedProjectedDistance, minimumHandFrontDepth),
  );
  setRiggedLongitudinalScale(
    `DEF-forearm.${side}`,
    correctedForearmLength / Math.max(0.0001, lengths.lower),
  );
  riggedAvatar?.updateMatrixWorld(true);
  const correctedEffectiveLength = forearmBone && handBone
    ? forearmBone.getWorldPosition(new THREE.Vector3())
      .distanceTo(handBone.getWorldPosition(new THREE.Vector3()))
    : correctedForearmLength;
  const correctedWristTarget = targetAtRiggedLength(
    actualElbow,
    correctedWristScreenTarget,
    correctedEffectiveLength,
    elbow,
    capturedWrist,
  );
  correctedWristTarget.z = actualElbow.z + Math.abs(correctedWristTarget.z - actualElbow.z);
  placeRiggedBoneBetween(
    `DEF-forearm.${side}`,
    actualElbow,
    correctedWristTarget,
    correctedEffectiveLength,
  );
  riggedAvatar?.updateMatrixWorld(true);
  driveRiggedPalmAndFingers(side, hand, handBone);
}

function retargetRiggedAvatar(frame: MotionFrame) {
  if (!riggedAvatar) return;
  const riggedFrame = stableRiggedFrames.get(frame) ?? frame;
  alignRiggedAvatar(riggedFrame.bodyHands);
  if (!riggedAligned) return;
  // Remove presentation-only breathing and sway before using a captured
  // frame. The original sign remains the sole source of body movement.
  restoreRiggedIdleBodyPose();
  // Apply the captured head pose before solving hand-to-face contacts. This
  // ensures a fingertip follows the character's final chin position instead
  // of a stale neutral-head position.
  applyRiggedLivelyFace(riggedFrame);
  riggedAvatar.updateMatrixWorld(true);
  const bindings = activeArmBindings ?? bindHandsToArms(riggedFrame);
  driveRiggedHand(
    'L',
    riggedFrame,
    bindings[0],
    !riggedHandsAtRest,
  );
  driveRiggedHand(
    'R',
    riggedFrame,
    bindings[1],
    !riggedHandsAtRest,
  );
  riggedAvatar.updateMatrixWorld(true);
}

function vectorValues(value: THREE.Vector3 | undefined) {
  return value ? [value.x, value.y, value.z].map(component => Number(component.toFixed(4))) : undefined;
}

function riggedFingerDiagnostics(
  side: 'L' | 'R',
  frame: MotionFrame | undefined,
  binding: ArmBinding | undefined,
) {
  if (!frame || binding?.handStart === undefined) return [];
  const hand = frame.bodyHands.slice(binding.handStart, binding.handStart + 21);
  return riggedFingerTargets.map(([boneName, fromIndex, toIndex]) => {
    const bone = riggedBone(`DEF-${boneName}.${side}`);
    const targetFrom = valid(hand[fromIndex]) ? riggedTargetPoint(hand[fromIndex]) : undefined;
    const targetTo = valid(hand[toIndex]) ? riggedTargetPoint(hand[toIndex]) : undefined;
    const actualFrom = bone?.getWorldPosition(new THREE.Vector3());
    const actualTo = bone ? riggedBoneEndpoint(bone.name) : undefined;
    const projectedError = actualTo && targetTo
      ? Math.hypot(actualTo.x - targetTo.x, actualTo.y - targetTo.y)
      : undefined;
    return {
      bone: boneName,
      fromIndex,
      toIndex,
      targetFrom: vectorValues(targetFrom),
      actualFrom: vectorValues(actualFrom),
      targetTo: vectorValues(targetTo),
      actualTo: vectorValues(actualTo),
      projectedError: projectedError === undefined ? undefined : Number(projectedError.toFixed(4)),
    };
  });
}

window.getVozualRigDiagnostics = () => {
  const frame = displayedFrame;
  const bindings = frame ? activeArmBindings ?? bindHandsToArms(frame) : [];
  const diagnostics = (['L', 'R'] as const).map((side, index) => {
    const binding = bindings[index];
    const handPoint = binding?.handStart === undefined ? undefined : frame?.bodyHands[binding.handStart];
    const boneDetails = [
      `DEF-upper_arm.${side}`,
      `DEF-upper_arm.${side}.001`,
      `DEF-forearm.${side}`,
      `DEF-forearm.${side}.001`,
      `DEF-hand.${side}`,
    ].map(name => {
      const bone = riggedBone(name);
      const rest = bone ? riggedBoneRests.get(bone.name) : undefined;
      return {
        name,
        position: vectorValues(bone?.getWorldPosition(new THREE.Vector3())),
        scale: vectorValues(bone?.scale),
        lengthAxis: rest?.lengthAxis,
        restLength: rest ? Number(rest.length.toFixed(4)) : undefined,
      };
    });
    return {
      side,
      targetShoulder: vectorValues(binding && frame && valid(frame.bodyHands[binding.shoulder])
        ? riggedTargetPoint(frame.bodyHands[binding.shoulder])
        : undefined),
      targetElbow: vectorValues(binding && frame && valid(frame.bodyHands[binding.elbow])
        ? riggedTargetPoint(frame.bodyHands[binding.elbow])
        : undefined),
      targetWrist: vectorValues(binding && frame && valid(frame.bodyHands[binding.wrist])
        ? riggedTargetPoint(frame.bodyHands[binding.wrist])
        : undefined),
      targetHandWrist: vectorValues(valid(handPoint) ? riggedTargetPoint(handPoint) : undefined),
      actualShoulder: vectorValues(riggedBone(`DEF-upper_arm.${side}`)?.getWorldPosition(new THREE.Vector3())),
      actualElbow: vectorValues(riggedBone(`DEF-forearm.${side}`)?.getWorldPosition(new THREE.Vector3())),
      actualWrist: vectorValues(riggedBone(`DEF-hand.${side}`)?.getWorldPosition(new THREE.Vector3())),
      requiredForearmLength: activeRiggedForearmLengths.get(side),
      boneDetails,
      fingers: riggedFingerDiagnostics(side, frame, binding),
    };
  });
  return {
    clipFrame: activeFrameIndex,
    aligned: riggedAligned,
    livelyFace: {
      expression: undefined,
      intensity: 0,
      leftTopLid: vectorValues(riggedBone('DEF-lid.T.L')?.getWorldPosition(new THREE.Vector3())),
      leftBottomLid: vectorValues(riggedBone('DEF-lid.B.L')?.getWorldPosition(new THREE.Vector3())),
      leftLipCorner: vectorValues(riggedBone('DEF-lip.T.L.001')?.getWorldPosition(new THREE.Vector3())),
    },
    arms: diagnostics,
  };
};

async function loadRiggedAvatar() {
  host.dataset.riggedStatus = 'loading';
  try {
    // Read the APK asset through VOZUAL's local-file bridge first. Calling
    // GLTFLoader.loadAsync() directly can leave large binary file:// requests
    // pending indefinitely on some Android WebView versions.
    const response = await fetch('./vozual_woman_avatar.glb', {cache: 'no-store'});
    if (!response.ok) throw new Error(`Rigged avatar returned ${response.status}.`);
    const binary = await response.arrayBuffer();
    host.dataset.riggedStatus = `parsing-${binary.byteLength}`;
    // ImageBitmapLoader can remain pending forever when it fetches embedded
    // GLB textures from a blob URL owned by an Android file:// WebView. Build
    // this parser with TextureLoader instead; the regular image element path
    // supports those object URLs and preserves the original materials.
    const bitmapDescriptor = Object.getOwnPropertyDescriptor(window, 'createImageBitmap');
    Object.defineProperty(window, 'createImageBitmap', {configurable: true, value: undefined});
    const parsePromise = new GLTFLoader().parseAsync(binary, './');
    if (bitmapDescriptor) Object.defineProperty(window, 'createImageBitmap', bitmapDescriptor);
    else delete (window as Window & {createImageBitmap?: typeof createImageBitmap}).createImageBitmap;
    const gltf = await parsePromise;
    riggedAvatar = gltf.scene;
    riggedAvatar.traverse(item => {
      if (item instanceof THREE.Bone) riggedBones.set(item.name, item);
      if (item instanceof THREE.Mesh) {
        item.castShadow = false;
        item.receiveShadow = false;
        item.frustumCulled = false;
        // Replace the oral materials at mesh level. The source asset's packed
        // GradAO/vertex-color setup can survive property cleanup in some GLTF
        // loader paths and appear as a green stripe inside the mouth.
        if (item.name === 'NUG_Base_Teeth') {
          item.material = new THREE.MeshStandardMaterial({
            name: 'VOZUAL_Teeth',
            color: 0xfff8ea,
            metalness: 0,
            roughness: 0.72,
          });
        } else if (item.name === 'NUG_Base_Tongue') {
          item.material = new THREE.MeshStandardMaterial({
            name: 'VOZUAL_Tongue',
            color: 0xa65f67,
            metalness: 0,
            roughness: 0.88,
          });
        }
        const materials = Array.isArray(item.material) ? item.material : [item.material];
        materials.forEach(material => {
          // Character Creator's cornea shell depends on Blender refraction.
          // glTF exports that shell as an opaque layer over the textured iris,
          // so use the underlying NUG_Eye geometry directly on mobile.
          if (/^NUG_Cornea_[LR]$/.test(material.name)) material.visible = false;
          if (material instanceof THREE.MeshStandardMaterial) {
            // The source oral materials use a desktop-only GradAO texture and
            // vertex-color mix. Android/iOS WebGL can interpret that packed
            // data as a green tint whenever facial motion exposes the teeth.
            // Oral color is an appearance invariant, not sign-language data,
            // so keep it neutral for every clip while preserving the original
            // teeth, tongue, facial bones and captured mouth movement.
            if (/^NUG_(Upper|Lower)_Teeth$/.test(material.name)) {
              material.map = null;
              material.aoMap = null;
              material.normalMap = null;
              material.vertexColors = false;
              material.color.set(0xfff8ea);
              material.emissive.set(0x000000);
              material.metalness = 0;
              material.roughness = 0.72;
            }
            if (material.name === 'NUG_Tongue') {
              material.map = null;
              material.aoMap = null;
              material.normalMap = null;
              material.vertexColors = false;
              material.color.set(0xa65f67);
              material.emissive.set(0x000000);
              material.metalness = 0;
              material.roughness = 0.88;
            }
            // The source character was authored for a desktop Blender light
            // rig. On mobile its strong normal map and low roughness created
            // a black spot on the nose plus clipped white patches on the
            // cheek and shoulder. Keep every texture, but present skin under
            // a softer physically based setup suited to this small viewport.
            if (/^NUG_Skin_/.test(material.name)) {
              material.metalness = 0;
              material.roughness = Math.max(0.86, material.roughness);
              material.normalScale.multiplyScalar(0.3);
            }
            if (material.name === 'NUG_Skin_Head') {
              // The packed desktop AO texture places an exaggerated dark
              // cavity on this stylized character's nose in Android WebView.
              // Ambient occlusion is decorative rather than anatomical, so
              // suppress it on the head while keeping diffuse facial detail.
              material.aoMap = null;
              material.normalMap = null;
              material.roughness = 1;
            }
            material.needsUpdate = true;
          }
        });
      }
    });
    const detachedFaceBone = [...riggedBones.entries()]
      .find(([name, bone]) => isDetachedFaceBoneName(name) && !(bone.parent instanceof THREE.Bone));
    if (detachedFaceBone) {
      throw new Error(`Rigged avatar has a detached facial bone: ${detachedFaceBone[0]}.`);
    }
    riggedAvatar.visible = false;
    scene.add(riggedAvatar);
    host.dataset.riggedStatus = 'loaded';
    if (displayedFrame) {
      retargetRiggedAvatar(displayedFrame);
      setFrame(displayedFrame);
    }
  } catch (error) {
    // A missing optional GLB must never disable the exact landmark renderers.
    riggedAvatar = undefined;
    const message = error instanceof Error ? error.message : String(error);
    host.dataset.riggedStatus = 'error';
    host.dataset.riggedError = message;
    console.error(`[Rigged avatar] ${message}`);
  }
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

function averageFaceLandmarks(face: Point[], indexes: readonly number[]): THREE.Vector3 | undefined {
  const landmarks = indexes.map(index => face[index]);
  if (!landmarks.every(valid)) return undefined;
  return landmarks.reduce(
    (result, point) => result.add(world(point)),
    new THREE.Vector3(),
  ).multiplyScalar(1 / landmarks.length);
}

function averageRiggedFaceBones(names: readonly string[]): THREE.Vector3 | undefined {
  const positions = names.flatMap(name => {
    const bone = riggedBone(name);
    return bone ? [bone.getWorldPosition(new THREE.Vector3())] : [];
  });
  if (positions.length === 0) return undefined;
  return positions.reduce(
    (result, point) => result.add(point),
    new THREE.Vector3(),
  ).multiplyScalar(1 / positions.length);
}

function riggedFaceOverlayProject(face: Point[]): ((source: Point) => THREE.Vector3) | undefined {
  if (!riggedAvatar || !riggedAligned) return undefined;
  const firstCapturedEye = averageFaceLandmarks(face, [33, 133, 159, 145]);
  const secondCapturedEye = averageFaceLandmarks(face, [263, 362, 386, 374]);
  const capturedMouth = averageFaceLandmarks(face, [13, 14]);
  const capturedChin = averageFaceLandmarks(face, [152]);
  const firstAvatarEye = riggedBone('DEF-eye.L')?.getWorldPosition(new THREE.Vector3());
  const secondAvatarEye = riggedBone('DEF-eye.R')?.getWorldPosition(new THREE.Vector3());
  const avatarMouth = averageRiggedFaceBones([
    'DEF-lip.T.L.001',
    'DEF-lip.T.R.001',
    'DEF-lip.B.L.001',
    'DEF-lip.B.R.001',
  ]);
  const avatarChin = riggedBone('DEF-chin')?.getWorldPosition(new THREE.Vector3())
    ?? riggedBone('DEF-chin.001')?.getWorldPosition(new THREE.Vector3());
  if (
    !firstCapturedEye
    || !secondCapturedEye
    || !capturedMouth
    || !capturedChin
    || !firstAvatarEye
    || !secondAvatarEye
    || !avatarMouth
    || !avatarChin
  ) return undefined;

  const capturedEyes = [firstCapturedEye, secondCapturedEye].sort((first, second) => first.x - second.x);
  const avatarEyes = [firstAvatarEye, secondAvatarEye].sort((first, second) => first.x - second.x);
  const toPoint = (value: THREE.Vector3): Point => [value.x, value.y, value.z];
  const sourceAnchors = {
    leftEye: toPoint(capturedEyes[0]),
    rightEye: toPoint(capturedEyes[1]),
    mouth: toPoint(capturedMouth),
    chin: toPoint(capturedChin),
  };
  const targetAnchors = {
    leftEye: toPoint(avatarEyes[0]),
    rightEye: toPoint(avatarEyes[1]),
    mouth: toPoint(avatarMouth),
    chin: toPoint(avatarChin),
  };
  return source => {
    const captured = world(source);
    const adapted = adaptFaceOverlayPoint(toPoint(captured), sourceAnchors, targetAnchors);
    return new THREE.Vector3(adapted[0], adapted[1], 0.1);
  };
}

function renderableFacePoint(source: Point | undefined, anchor: Point | undefined): source is Point {
  return valid(source) && anchor !== undefined &&
    Math.abs(source[0] - anchor[0]) <= maxFaceHorizontalDistance &&
    Math.abs(source[1] - anchor[1]) <= maxFaceVerticalDistance;
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
  const startHead = start.headOrientation ?? end.headOrientation;
  const endHead = end.headOrientation ?? start.headOrientation;
  return {
    bodyHands: start.bodyHands.map((point, index) => mixPoint(point, end.bodyHands[index] ?? point, amount)),
    face: start.face.map((point, index) => mixPoint(point, end.face[index] ?? point, amount)),
    headOrientation: startHead && endHead ? {
      yaw: startHead.yaw + (endHead.yaw - startHead.yaw) * amount,
      pitch: startHead.pitch + (endHead.pitch - startHead.pitch) * amount,
      roll: startHead.roll + (endHead.roll - startHead.roll) * amount,
    } : undefined,
  };
}

function forearmLengthsForMotion(
  motion: Motion,
  bindings: ArmBinding[],
): Map<'L' | 'R', number> {
  const result = new Map<'L' | 'R', number>();
  (['L', 'R'] as const).forEach((side, index) => {
    const binding = bindings[index];
    if (!binding) return;
    let maximumProjectedLength = 0;
    motion.frames.forEach(frame => {
      const elbow = frame.bodyHands[binding.elbow];
      const capturedHandWrist = binding.handStart === undefined
        ? undefined
        : frame.bodyHands[binding.handStart];
      const wrist = valid(capturedHandWrist)
        ? capturedHandWrist
        : frame.bodyHands[binding.wrist];
      if (!valid(elbow) || !valid(wrist)) return;
      const projectedElbow = riggedTargetPoint(elbow);
      const projectedWrist = riggedTargetPoint(wrist);
      maximumProjectedLength = Math.max(
        maximumProjectedLength,
        Math.hypot(
          projectedWrist.x - projectedElbow.x,
          projectedWrist.y - projectedElbow.y,
        ),
      );
    });
    if (maximumProjectedLength > 0) result.set(side, maximumProjectedLength);
  });
  return result;
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
  return {
    bodyHands,
    face,
    headOrientation: {yaw: 0, pitch: 0, roll: 0},
  };
}

function setFrame(frame: MotionFrame) {
  displayedFrame = frame;
  const bodyHands = frame.bodyHands;
  const face = frame.face;
  // The hybrid diagnostic needs the avatar's current eye, lip and chin bones
  // before projecting human Face Mesh points onto its stylized proportions.
  retargetRiggedAvatar(frame);
  const showCartoonBody = shouldDrawCartoonAvatar();
  // In cartoon mode, hands and body are rendered by derived 2D geometry. Face
  // landmarks remain visible until the dedicated facial phase replaces them.
  skeleton.visible = !showCartoonBody;
  joints.visible = !showCartoonBody;
  facePoints.visible = !showCartoonBody;
  expressionPoints.visible = !showCartoonBody;
  torso.visible = !showCartoonBody;
  neck.visible = !showCartoonBody;
  bodyJoints.visible = !showCartoonBody;
  const armBindings = activeArmBindings ?? bindHandsToArms(frame);
  const anchor = faceAnchor(face);
  const fallback = anchor ? undefined : fallbackHead(bodyHands);
  const capturedFaceProject = anchor ? faceProject(anchor) : world;
  const projectFace = renderMode === 'hybrid'
    ? riggedFaceOverlayProject(face) ?? capturedFaceProject
    : capturedFaceProject;
  let offset = 0;
  const renderedBindings = showCapturedHands
    ? armBindings.map(binding =>
      showCartoonBody && binding.handStart !== undefined
        ? {...binding, handStart: undefined}
        : binding,
    )
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
    writePoint(jointPositions, index * 3, visiblePoseLandmarks.has(index) ? bodyHands[index] : undefined);
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
    writePoint(facePositions, index * 3, renderableFacePoint(face[index], anchor) ? face[index] : undefined, projectFace);
  }
  expressionLandmarks.forEach((landmark, index) => {
    writePoint(
      expressionPositions,
      index * 3,
      renderableFacePoint(face[landmark], anchor) ? face[landmark] : undefined,
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
  if (showCartoonBody) neck.visible = false;

  mannequinSegments.forEach(([start, end, thickness], index) => {
    placeLimb(index, bodyHands[start], bodyHands[end], thickness);
  });
  if (showCartoonBody) limbCapsules.forEach(limb => { limb.visible = false; });

  // LSC animation is communicated by torso and upper limbs; lower-body
  // tracking creates noisy floating points without adding useful information.
  const majorJointIndexes = [11, 13, 15, 12, 14, 16, 23, 24];
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

  updateCartoonBody(frame);
  updateCartoonHands(frame);
  updateCartoonFace(frame, projectFace, anchor);

  const showRiggedAvatar = shouldDrawRiggedAvatar();
  if (riggedAvatar) riggedAvatar.visible = showRiggedAvatar;
  if (showRiggedAvatar && renderMode === 'hybrid') {
    // Hybrid mode is a landmark comparison, not a second mannequin. Keep the
    // thin skeleton and points while removing opaque diagnostic body shapes.
    torso.visible = false;
    neck.visible = false;
    bodyJoints.visible = false;
    limbCapsules.forEach(limb => { limb.visible = false; });
  }
  if (showRiggedAvatar && renderMode === 'rigged') {
    // The rigged character owns the silhouette in PERSONAJE mode. PUNTOS and
    // CARICATURA remain untouched for direct fidelity comparison.
    skeleton.visible = false;
    joints.visible = false;
    facePoints.visible = false;
    expressionPoints.visible = false;
    torso.visible = false;
    neck.visible = false;
    headFill.visible = false;
    bodyJoints.visible = false;
    limbCapsules.forEach(limb => { limb.visible = false; });
    cartoonBody.group.visible = false;
    cartoonFace.group.visible = false;
    cartoonHands.forEach(layer => { layer.group.visible = false; });
  }
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
  const retargetBody = (point: Point): Point => !valid(point) ? point : [
    0.5 + (point[0] - shoulderCenter[0]) * bodyScaleX,
    0.68 + (point[1] - shoulderCenter[1]) * bodyScaleY,
    point[2],
  ];
  // MediaPipe body and face landmarks belong to the same captured frame.
  // Transforming the face independently destroys contact relationships such
  // as hand-to-chin and hand-to-mouth. A single shoulder-based transform
  // preserves the geometry visible in VOZUAL's diagnostic points.
  const retargetFace = retargetBody;
  return {
    fps: motion.fps,
    frames: motion.frames.map(frame => {
      const headOrientation = capturedHeadOrientation(frame.face);
      return {
        bodyHands: frame.bodyHands.map(retargetBody),
        face: frame.face.map(retargetFace),
        headOrientation,
      };
    }),
  };
}

function makeSingleHandMotion(motion: Motion, activeArmIndex: number): Motion {
  // Camera tracking can give the resting arm a little noise, which looks
  // dramatic once applied to a real rig. Keep the quieter side neutral for
  // signs whose captured motion clearly belongs to only one hand.
  const bindings = bindingsForMotion(motion);
  const restingFrame = makeRestPose(motion.frames[0], bindings);
  const inactiveArm = bindings[activeArmIndex === 0 ? 1 : 0];
  const frozenIndexes = [inactiveArm.elbow, inactiveArm.wrist];
  if (inactiveArm.handStart !== undefined) {
    frozenIndexes.push(...Array.from(
      {length: 21},
      (_, index) => inactiveArm.handStart! + index,
    ));
  }
  return {
    fps: motion.fps,
    frames: motion.frames.map(frame => {
      const bodyHands = frame.bodyHands.map(copyPoint);
      frozenIndexes.forEach(index => { bodyHands[index] = copyPoint(restingFrame.bodyHands[index]); });
      return {
        bodyHands,
        face: frame.face.map(copyPoint),
        headOrientation: frame.headOrientation,
      };
    }),
  };
}

function isClearlyOneHanded(motion: Motion, forceTwoHands = false): boolean {
  const leftScore = armMotionScore(motion, 0);
  const rightScore = armMotionScore(motion, 1);
  const bothHandsCaptured = bindingsForMotion(motion)
    .every(binding => binding.handStart !== undefined);
  return shouldUseSingleHandRig(
    leftScore,
    rightScore,
    forceTwoHands,
    bothHandsCaptured,
  );
}

function cacheRiggedPresentationFrames(
  motion: Motion,
  activeArmIndex: number,
  presentation: RiggedHandPresentation,
  trackingRepair?: RiggedHandTrackingRepair,
) {
  const binding = bindingsForMotion(motion)[activeArmIndex];
  if (!binding || binding.handStart === undefined) return;
  const handIndexes = Array.from({length: 21}, (_, index) => binding.handStart! + index);
  const preservesCapturedFrames = presentation === 'anatomical' || presentation === 'captured';
  const indexes = preservesCapturedFrames
    ? handIndexes
    : [binding.elbow, binding.wrist, ...handIndexes];
  const temporalWeights = preservesCapturedFrames
    ? [1]
    : [1, 2, 3, 4, 3, 2, 1];
  const temporalRadius = Math.floor(temporalWeights.length / 2);
  const smoothedFrames = motion.frames.map((frame, frameIndex) => {
    const bodyHands = (
      stableRiggedFrames.get(frame)?.bodyHands ?? frame.bodyHands
    ).map(copyPoint);
    indexes.forEach(pointIndex => {
      const original = frame.bodyHands[pointIndex];
      // A zero triplet means that MediaPipe did not detect this landmark.
      // Keep it missing instead of extending a hand beyond its captured life.
      if (!valid(original)) return;
      const weightedPoint: Point = [0, 0, 0];
      let totalWeight = 0;
      temporalWeights.forEach((weight, weightIndex) => {
        const candidate = motion.frames[frameIndex + weightIndex - temporalRadius]?.bodyHands[pointIndex];
        if (!valid(candidate)) return;
        totalWeight += weight;
        weightedPoint[0] += candidate[0] * weight;
        weightedPoint[1] += candidate[1] * weight;
        weightedPoint[2] += candidate[2] * weight;
      });
      if (totalWeight > 0) {
        bodyHands[pointIndex] = [
          weightedPoint[0] / totalWeight,
          weightedPoint[1] / totalWeight,
          weightedPoint[2] / totalWeight,
        ];
      }
    });
    return bodyHands;
  });
  const smoothedHands = smoothedFrames.map(bodyHands => (
    bodyHands.slice(binding.handStart!, binding.handStart! + 21)
  ));
  const capturedHands = trackingRepair === 'stable-palm'
    ? repairStablePalmHandLandmarkFrames(smoothedHands)
    : presentCapturedHandLandmarkFrames(smoothedHands);
  const anatomicalHands = presentAnatomicalHandLandmarkFrames(smoothedHands);
  const fistHands = presentation === 'fist'
    ? presentFistHandLandmarkFrames(anatomicalHands)
    : undefined;
  const pointingHands = presentation === 'pointing'
    ? presentPointingHandLandmarkFrames(anatomicalHands)
    : undefined;
  const selfPointingHands = presentation === 'self-pointing'
    ? presentSelfPointingHandLandmarkFrames(smoothedHands)
    : undefined;
  const indexOnlyHands = presentation === 'index-only'
    ? presentIndexOnlyHandLandmarkFrames(smoothedHands)
    : undefined;
  const thumbUpHands = presentation === 'thumb-up'
    ? presentThumbUpHandLandmarkFrames(smoothedHands)
    : undefined;
  motion.frames.forEach((frame, frameIndex) => {
    const bodyHands = smoothedFrames[frameIndex];
    const capturedHand = anatomicalHands[frameIndex];
    const presentedHand = presentation === 'captured'
      ? capturedHands[frameIndex]
      : presentation === 'open'
      ? straightenOpenHandLandmarks(capturedHand)
      : presentation === 'open-palm'
        ? capturedHands[frameIndex]
      : presentation === 'fist'
        ? fistHands![frameIndex]
        : presentation === 'pointing'
          ? pointingHands![frameIndex]
          : presentation === 'self-pointing'
            ? selfPointingHands![frameIndex]
            : presentation === 'index-only'
              ? indexOnlyHands![frameIndex]
            : presentation === 'thumb-up'
              ? thumbUpHands![frameIndex]
          : presentation === 'soft-curl'
            ? softenFingerCurlLandmarks(capturedHand, 0.58)
            : capturedHand;
    presentedHand.forEach((point, handIndex) => {
      bodyHands[binding.handStart! + handIndex] = point;
    });
    // This derived frame is read only and belongs exclusively to the rigged
    // renderer. Point and cartoon modes continue to display the source frame.
    stableRiggedFrames.set(frame, {
      bodyHands,
      face: frame.face,
      headOrientation: frame.headOrientation,
    });
  });
}

function retainMotion(clip: ClipName, motion: Motion) {
  motions.set(clip, motion);
  const previousIndex = motionCacheOrder.indexOf(clip);
  if (previousIndex >= 0) motionCacheOrder.splice(previousIndex, 1);
  motionCacheOrder.push(clip);
  while (motionCacheOrder.length > MAX_CACHED_MOTIONS) {
    const expiredClip = motionCacheOrder.shift();
    if (expiredClip) motions.delete(expiredClip);
  }
}

function markMotionUsed(clip: ClipName) {
  const previousIndex = motionCacheOrder.indexOf(clip);
  if (previousIndex < 0) return;
  motionCacheOrder.splice(previousIndex, 1);
  motionCacheOrder.push(clip);
}

async function loadMotion(clip: string): Promise<Motion> {
  const response = await fetch(`./motions/${motionAssetName(clip)}.motion.bin`);
  if (!response.ok) throw new Error(`No se pudo cargar el movimiento ${clip}.`);
  const motion = decodeCompactMotion(new Uint8Array(await response.arrayBuffer()));
  if (!Array.isArray(motion.frames) || motion.frames.length < 2) {
    throw new Error(`El movimiento ${clip} no contiene cuadros suficientes.`);
  }
  const normalizedClip = clip.toUpperCase();
  const profile = avatarProfiles.get(normalizedClip);
  const isOneHanded = isClearlyOneHanded(motion, profile?.forceTwoHands);
  const activeArmIndex = armMotionScore(motion, 0) >= armMotionScore(motion, 1) ? 0 : 1;
  const signMotion = isOneHanded ? makeSingleHandMotion(motion, activeArmIndex) : motion;
  const retargetedMotion = retargetMotion(signMotion);
  retainMotion(normalizedClip, retargetedMotion);
  const singleHandedSide = isOneHanded ? (activeArmIndex === 0 ? 'L' : 'R') : undefined;
  if (singleHandedSide) singleHandedRigSides.set(retargetedMotion, singleHandedSide);
  const presentationArms = presentationArmIndexes(singleHandedSide);
  if (profile?.rigLeftHandShape || profile?.rigRightHandShape) {
    anatomicalRiggedHandMotions.add(retargetedMotion);
    presentationArms.forEach(armIndex => cacheRiggedPresentationFrames(
      retargetedMotion,
      armIndex,
      armIndex === 0
        ? profile.rigLeftHandShape ?? 'anatomical'
        : profile.rigRightHandShape ?? 'anatomical',
      armIndex === 0
        ? profile.rigLeftHandTrackingRepair
        : profile.rigRightHandTrackingRepair,
    ));
  } else if (profile?.rigFistHands) {
    fistRiggedHandMotions.add(retargetedMotion);
    presentationArms.forEach(armIndex => cacheRiggedPresentationFrames(retargetedMotion, armIndex, 'fist'));
  } else if (profile?.rigSelfPointingHand) {
    pointingRiggedHandMotions.add(retargetedMotion);
    presentationArms.forEach(armIndex => cacheRiggedPresentationFrames(retargetedMotion, armIndex, 'self-pointing'));
  } else if (profile?.rigPointingHand) {
    pointingRiggedHandMotions.add(retargetedMotion);
    presentationArms.forEach(armIndex => cacheRiggedPresentationFrames(retargetedMotion, armIndex, 'pointing'));
  } else if (normalizedClip === 'HOLA' || profile?.rigStableOpenHand) {
    stableRiggedHandMotions.add(retargetedMotion);
    presentationArms.forEach(armIndex => cacheRiggedPresentationFrames(retargetedMotion, armIndex, 'open'));
  } else if (profile?.rigSoftHandCurl) {
    softCurlRiggedHandMotions.add(retargetedMotion);
    presentationArms.forEach(armIndex => cacheRiggedPresentationFrames(retargetedMotion, armIndex, 'soft-curl'));
  } else {
    anatomicalRiggedHandMotions.add(retargetedMotion);
    presentationArms.forEach(armIndex => cacheRiggedPresentationFrames(retargetedMotion, armIndex, 'anatomical'));
  }
  return retargetedMotion;
}

function ensureMotion(clip: string): Promise<Motion> {
  const normalizedClip = clip.trim().toUpperCase();
  const cached = motions.get(normalizedClip);
  if (cached) {
    markMotionUsed(normalizedClip);
    return Promise.resolve(cached);
  }
  const currentLoad = motionLoads.get(normalizedClip);
  if (currentLoad) return currentLoad;
  const nextLoad = loadMotion(normalizedClip).then(
    motion => {
      motionLoads.delete(normalizedClip);
      return motion;
    },
    error => {
      motionLoads.delete(normalizedClip);
      throw error;
    },
  );
  motionLoads.set(normalizedClip, nextLoad);
  return nextLoad;
}

async function loadAvatarProfiles() {
  const response = await fetch('./motions/avatar_profiles.json');
  if (!response.ok) throw new Error('No se pudieron cargar los perfiles de animación.');
  const data = await response.json() as Record<string, AvatarProfile>;
  Object.entries(data).forEach(([gloss, profile]) => avatarProfiles.set(gloss.toUpperCase(), profile));
}

function playClip(
  clip: ClipName,
  playbackId: number,
  playbackSpeed = 1,
  continuePhrase = false,
) {
  if (clip === 'PHRASE_WAIT') {
    activeMotion = undefined;
    pendingMotion = undefined;
    transitionStart = undefined;
    transitionTarget = undefined;
    if (displayedFrame) {
      const phraseRest = makeRestPose(
        activeRestReference ?? displayedFrame,
        neutralArmBindings(),
      );
      returnStart = displayedFrame;
      returnTarget = mixFrame(displayedFrame, phraseRest, PHRASE_COAST_TO_REST_RATIO);
      returnStartedAt = performance.now();
      returnDurationSeconds = PHRASE_CONTINUATION_GRACE_MS / 1000;
    }
    return;
  }
  if (clip === 'IDLE') {
    riggedHandsAtRest = true;
    activeProfile = undefined;
    activeRiggedHandPresentations = {};
    activeRiggedHand = undefined;
    activeStableRiggedHandShape = false;
    activeSoftCurlRiggedHandShape = false;
    activeFistRiggedHandShape = false;
    activePointingRiggedHandShape = false;
    activeAnatomicalRiggedHandShape = false;
    activeFrameIndex = -1;
    activeMotion = undefined;
    pendingMotion = undefined;
    transitionStart = undefined;
    transitionTarget = undefined;
    activeRiggedForearmLengths.clear();
    if (displayedFrame) {
      showCapturedHands = true;
      returnStart = displayedFrame;
      // Return to the exact side and horizontal position where this sign
      // started. Never derive a new side from its last tracked wrist.
      activeArmBindings = neutralArmBindings();
      returnTarget = makeRestPose(activeRestReference ?? displayedFrame, activeArmBindings);
      returnStartedAt = performance.now();
      returnDurationSeconds = RETURN_TO_REST_SECONDS;
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
  markMotionUsed(clip.toUpperCase());
  const playbackRange = signPlaybackRange(motion);
  const startFrame = continuePhrase ? playbackRange.continuationStartFrame : 0;
  const endFrame = Math.max(startFrame, playbackRange.endFrame);
  const previousFrame = displayedFrame;
  const previousBindings = previousFrame
    ? activeArmBindings ?? bindHandsToArms(previousFrame)
    : [];
  const targetBindings = bindingsForMotion(motion);
  const playbackMotion = continuePhrase && previousFrame
    ? coarticulateSignMotion(
      motion,
      previousFrame,
      startFrame,
      endFrame,
      previousBindings,
      targetBindings,
    )
    : motion;
  riggedHandsAtRest = false;
  activeProfile = avatarProfiles.get(clip.toUpperCase());
  activeRiggedHandPresentations = {
    L: activeProfile?.rigLeftHandShape,
    R: activeProfile?.rigRightHandShape,
  };
  activeRiggedHand = singleHandedRigSides.get(motion);
  activeStableRiggedHandShape = stableRiggedHandMotions.has(motion);
  activeSoftCurlRiggedHandShape = softCurlRiggedHandMotions.has(motion);
  activeFistRiggedHandShape = fistRiggedHandMotions.has(motion);
  activePointingRiggedHandShape = pointingRiggedHandMotions.has(motion);
  activeAnatomicalRiggedHandShape = anatomicalRiggedHandMotions.has(motion);
  showCapturedHands = true;
  activeArmBindings = targetBindings;
  activeRiggedForearmLengths = forearmLengthsForMotion(playbackMotion, activeArmBindings);
  if (
    (activeStableRiggedHandShape || activeSoftCurlRiggedHandShape || activeFistRiggedHandShape || activePointingRiggedHandShape || activeAnatomicalRiggedHandShape)
    && playbackMotion !== motion
  ) {
    const armIndexes = presentationArmIndexes(activeRiggedHand);
    armIndexes.forEach(armIndex => cacheRiggedPresentationFrames(
      playbackMotion,
      armIndex,
      (armIndex === 0
        ? activeProfile?.rigLeftHandShape
        : activeProfile?.rigRightHandShape)
        ?? (activeStableRiggedHandShape
        ? 'open'
        : activeFistRiggedHandShape
          ? 'fist'
          : activePointingRiggedHandShape
            ? activeProfile?.rigSelfPointingHand
              ? 'self-pointing'
              : 'pointing'
            : activeSoftCurlRiggedHandShape
              ? 'soft-curl'
              : 'anatomical'),
      armIndex === 0
        ? activeProfile?.rigLeftHandTrackingRepair
        : activeProfile?.rigRightHandTrackingRepair,
    ));
  }
  activeRestReference = motion.frames[0];
  activeFaceReference = motion.frames.find(candidate => (
    capturedFacePresentation(candidate.face, candidate.face) != null
  ))?.face;
  activeFaceCalibration = capturedFaceCalibration(motion);
  returnStart = undefined;
  returnTarget = undefined;
  activePlaybackId = playbackId;
  activePlaybackSpeed = Math.min(4, Math.max(1, playbackSpeed));
  activeStartFrame = startFrame;
  activeEndFrame = endFrame;
  activeFrameIndex = -1;
  lastFrame = -1;
  ended = false;
  // A spoken next word can arrive while the previous hand is returning to
  // rest. Blend directly from that visible pose to the next sign's first
  // captured pose; do not force an artificial return to zero in between.
  if (previousFrame) {
    activeMotion = undefined;
    transitionStart = previousFrame;
    transitionTarget = playbackMotion.frames[startFrame];
    transitionStartedAt = performance.now();
    transitionDurationSeconds = continuePhrase ? 0.1 : SIGN_TRANSITION_SECONDS;
    pendingMotion = playbackMotion;
    pendingMotionStartFrame = startFrame;
    pendingMotionEndFrame = endFrame;
    return;
  }
  pendingMotion = undefined;
  activeMotion = playbackMotion;
  activeStartedAt = performance.now();
  setFrame(playbackMotion.frames[startFrame]);
}

let latestPlaybackRequest = 0;

function requestClip(
  clip: ClipName,
  playbackId: number,
  playbackSpeed = 1,
  continuePhrase = false,
) {
  const requestId = ++latestPlaybackRequest;
  if (clip === 'IDLE' || clip === 'PHRASE_WAIT') {
    playClip(clip, playbackId, playbackSpeed, continuePhrase);
    return;
  }
  const normalizedClip = clip.trim().toUpperCase();
  ensureMotion(normalizedClip).then(
    () => {
      // Loading is asynchronous. Do not let an older request replace a newer
      // word that arrived while its asset was being decoded.
      if (requestId !== latestPlaybackRequest) return;
      playClip(normalizedClip, playbackId, playbackSpeed, continuePhrase);
    },
    error => {
      if (requestId !== latestPlaybackRequest) return;
      send('error', {
        message: error instanceof Error ? error.message : String(error),
        playbackId,
      });
      // Release the React Native queue even if one published asset is damaged.
      send('ended', {playbackId});
    },
  );
}

window.playVozualClip = requestClip;

function playbackBaseFps(motion: Motion, startFrame: number, endFrame: number) {
  return Math.min(
    Math.max(1, motion.fps),
    Math.max(1, (endFrame - startFrame) / MIN_SIGN_PLAYBACK_SECONDS),
  );
}

function currentPlaybackState(now = performance.now()): PlaybackState {
  const motion = activeMotion ?? pendingMotion;
  const startFrame = activeMotion ? activeStartFrame : pendingMotionStartFrame;
  const endFrame = activeMotion ? activeEndFrame : pendingMotionEndFrame;
  if (!motion) {
    return {active: false, paused: playbackPaused, positionMs: 0, durationMs: 0, frameIndex: -1};
  }
  const baseFps = playbackBaseFps(motion, startFrame, endFrame);
  const durationMs = Math.max(0, ((endFrame - startFrame) / baseFps) * 1000);
  const clock = playbackPaused ? playbackPausedAt : now;
  const positionMs = activeMotion
    ? Math.min(durationMs, Math.max(0, (clock - activeStartedAt) * activePlaybackSpeed))
    : 0;
  const frameIndex = Math.min(
    endFrame,
    startFrame + Math.floor((positionMs / 1000) * baseFps),
  );
  return {active: true, paused: playbackPaused, positionMs, durationMs, frameIndex};
}

window.setVozualPlaybackPaused = (paused: boolean) => {
  if (paused === playbackPaused) return playbackPaused;
  const now = performance.now();
  if (paused) {
    // Use one frozen clock value for motion, transitions and return-to-rest.
    // The source motion and its frame timing remain untouched.
    renderAnimationFrame(now);
    playbackPaused = true;
    playbackPausedAt = now;
    return true;
  }
  const pausedDuration = Math.max(0, now - playbackPausedAt);
  activeStartedAt += pausedDuration;
  transitionStartedAt += pausedDuration;
  returnStartedAt += pausedDuration;
  playbackPaused = false;
  playbackPausedAt = 0;
  return false;
};

window.getVozualPlaybackState = () => currentPlaybackState();

window.seekVozualPlayback = (requestedPositionMs: number) => {
  if (!activeMotion && pendingMotion) {
    activeMotion = pendingMotion;
    activeStartFrame = pendingMotionStartFrame;
    activeEndFrame = pendingMotionEndFrame;
    pendingMotion = undefined;
    transitionStart = undefined;
    transitionTarget = undefined;
  }
  if (!activeMotion) return currentPlaybackState();

  const baseFps = playbackBaseFps(activeMotion, activeStartFrame, activeEndFrame);
  const durationMs = Math.max(
    0,
    ((activeEndFrame - activeStartFrame) / baseFps) * 1000,
  );
  const positionMs = Math.min(
    durationMs,
    Math.max(0, Number.isFinite(requestedPositionMs) ? requestedPositionMs : 0),
  );
  const now = performance.now();
  activeStartedAt = now - positionMs / activePlaybackSpeed;
  playbackPaused = true;
  playbackPausedAt = now;
  lastFrame = -1;
  ended = positionMs >= durationMs;
  renderAnimationFrame(now);
  return currentPlaybackState(now);
};

window.setVozualDebugFrame = (clip: string, frameIndex: number) => {
  const motion = motions.get(clip.trim().toUpperCase());
  if (!motion) return false;
  riggedHandsAtRest = false;
  activeProfile = avatarProfiles.get(clip.trim().toUpperCase());
  activeRiggedHandPresentations = {
    L: activeProfile?.rigLeftHandShape,
    R: activeProfile?.rigRightHandShape,
  };
  activeRiggedHand = singleHandedRigSides.get(motion);
  activeStableRiggedHandShape = stableRiggedHandMotions.has(motion);
  activeSoftCurlRiggedHandShape = softCurlRiggedHandMotions.has(motion);
  activeFistRiggedHandShape = fistRiggedHandMotions.has(motion);
  activePointingRiggedHandShape = pointingRiggedHandMotions.has(motion);
  activeAnatomicalRiggedHandShape = anatomicalRiggedHandMotions.has(motion);
  const safeFrameIndex = Math.min(motion.frames.length - 1, Math.max(0, Math.round(frameIndex)));
  activeMotion = undefined;
  pendingMotion = undefined;
  transitionStart = undefined;
  transitionTarget = undefined;
  returnStart = undefined;
  returnTarget = undefined;
  activeArmBindings = bindingsForMotion(motion);
  activeRiggedForearmLengths = forearmLengthsForMotion(motion, activeArmBindings);
  activeRestReference = motion.frames[0];
  activeFaceReference = motion.frames.find(candidate => (
    capturedFacePresentation(candidate.face, candidate.face) != null
  ))?.face;
  activeFaceCalibration = capturedFaceCalibration(motion);
  activeFrameIndex = safeFrameIndex;
  setFrame(motion.frames[safeFrameIndex]);
  return true;
};

function resize() {
  // The production WebView fills the window, while the desktop review page
  // mounts this same runtime inside a phone-shaped viewport. Reading the host
  // dimensions keeps both paths identical without stretching the preview to
  // the surrounding desktop browser window.
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height, false);
  const halfHeight = ORTHOGRAPHIC_VIEW_HEIGHT / 2;
  const halfWidth = halfHeight * (width / height);
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}

function renderAnimationFrame(now = performance.now()) {
  if (playbackPaused) now = playbackPausedAt;
  if (transitionStart && transitionTarget && pendingMotion) {
    const linearProgress = Math.min(1, (now - transitionStartedAt) / (transitionDurationSeconds * 1000));
    const smoothProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
    setFrame(mixFrame(transitionStart, transitionTarget, smoothProgress));
    if (linearProgress >= 1) {
      const nextMotion = pendingMotion;
      const nextStartFrame = pendingMotionStartFrame;
      const nextEndFrame = pendingMotionEndFrame;
      transitionStart = undefined;
      transitionTarget = undefined;
      pendingMotion = undefined;
      activeMotion = nextMotion;
      activeStartFrame = nextStartFrame;
      activeEndFrame = nextEndFrame;
      activeStartedAt = performance.now();
      lastFrame = nextStartFrame - 1;
      setFrame(nextMotion.frames[nextStartFrame]);
    }
  } else if (returnStart && returnTarget) {
    const linearProgress = Math.min(1, (now - returnStartedAt) / (returnDurationSeconds * 1000));
    const smoothProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
    setFrame(mixFrame(returnStart, returnTarget, smoothProgress));
    if (linearProgress >= 1) {
      returnStart = undefined;
      returnTarget = undefined;
      setFrame(returnTarget);
    }
  } else if (activeMotion) {
    const elapsed = (now - activeStartedAt) / 1000;
    const playbackFps = playbackBaseFps(
      activeMotion,
      activeStartFrame,
      activeEndFrame,
    ) * activePlaybackSpeed;
    const frameProgress = Math.min(
      activeEndFrame,
      activeStartFrame + elapsed * playbackFps,
    );
    const frameIndex = Math.min(
      activeMotion.frames.length - 1,
      Math.floor(frameProgress),
    );
    if (frameIndex !== lastFrame) {
      activeFrameIndex = frameIndex;
      setFrame(activeMotion.frames[frameIndex]);
      lastFrame = frameIndex;
    }
    // HOLA has a derived, zero-phase stabilization profile for its rigged
    // hand. Interpolate that presentation on every display refresh so a 60 Hz
    // screen does not alternate between repeated and abruptly changed 30 Hz
    // poses. Source landmarks, frame count and timestamps remain untouched.
    if (
      (activeStableRiggedHandShape || activeSoftCurlRiggedHandShape || activeFistRiggedHandShape || activePointingRiggedHandShape || activeAnatomicalRiggedHandShape)
      && renderMode === 'rigged'
      && frameIndex < activeEndFrame
    ) {
      const sourceStart = activeMotion.frames[frameIndex];
      const sourceEnd = activeMotion.frames[frameIndex + 1];
      const stableStart = stableRiggedFrames.get(sourceStart) ?? sourceStart;
      const stableEnd = stableRiggedFrames.get(sourceEnd) ?? sourceEnd;
      retargetRiggedAvatar(mixFrame(stableStart, stableEnd, frameProgress - frameIndex));
    }
    if (frameIndex === activeEndFrame && !ended) {
      ended = true;
      send('ended', {playbackId: activePlaybackId});
    }
  }
  if (riggedHandsAtRest && !activeMotion && !pendingMotion && !transitionStart && !returnStart) {
    applyRiggedIdleBody(now);
    applyRiggedLivelyFace();
  }
  renderer.render(scene, camera);
}

window.tickVozualAnimation = () => {
  renderAnimationFrame();
  return true;
};

function animate() {
  requestAnimationFrame(animate);
  renderAnimationFrame();
}

async function loadPublishedMotions() {
  const response = await fetch('./motions/published_signs.json');
  if (!response.ok) throw new Error('No se pudo cargar el catálogo de señas publicadas.');
  const catalog = await response.json() as {publishedGlosses?: unknown};
  const clips = Array.isArray(catalog.publishedGlosses)
    ? catalog.publishedGlosses.map(value => String(value).trim().toUpperCase()).filter(Boolean)
    : [];
  if (clips.length === 0) throw new Error('No hay señas publicadas en la app.');
  // One captured frame is enough to construct the initial rest pose. The
  // remaining signs are decoded only when speech actually requests them.
  const initialClip = clips.includes('HOLA') ? 'HOLA' : clips[0];
  await ensureMotion(initialClip);
  return clips;
}

// Load the rigged character before announcing readiness so the first visible
// idle frame already matches the selected renderer. A model-loading failure
// falls back to the procedural character without affecting speech or signs.
loadAvatarProfiles()
  .then(() => Promise.all([loadPublishedMotions(), loadRiggedAvatar()]))
  .then(([clips]) => {
    playClip('IDLE', 0);
    scene.visible = true;
    renderer.render(scene, camera);
    send('ready', {
      clips: ['IDLE', ...clips],
      riggedStatus: host.dataset.riggedStatus,
      riggedError: host.dataset.riggedError,
      riggedAligned,
      riggedBoneCount: riggedBones.size,
      riggedHasShoulders: Boolean(riggedBone('DEF-upper_arm.L') && riggedBone('DEF-upper_arm.R')),
    });
  })
  .catch(error => send('error', {message: error instanceof Error ? error.message : String(error)}));

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(host);
resize();
animate();
