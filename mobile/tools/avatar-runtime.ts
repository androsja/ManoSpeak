import * as THREE from 'three';
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

type ClipName = 'IDLE' | 'HOLA' | 'GRACIAS';

declare global {
  interface Window {
    playVozualClip: (clip: ClipName, playbackId: number) => void;
    ReactNativeWebView?: {postMessage: (message: string) => void};
  }
}

const host = document.getElementById('avatar') as HTMLDivElement;

// Chromium intentionally rejects fetch(file://...), while Android WebView can
// safely read files that belong to this APK through XMLHttpRequest. Three's
// loaders use fetch internally, so bridge only local asset requests here.
const webFetch = window.fetch.bind(window);
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
scene.background = new THREE.Color('#343936');

const camera = new THREE.PerspectiveCamera(31, 1, 0.01, 100);
camera.position.set(0, 0.08, 4.3);
camera.lookAt(0, 0.08, 0);

const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
host.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x52606b, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
keyLight.position.set(-2.5, 4, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb8d9ff, 1.4);
fillLight.position.set(3, 1, 2);
scene.add(fillLight);

const clock = new THREE.Clock();
let mixer: THREE.AnimationMixer | undefined;
let currentAction: THREE.AnimationAction | undefined;
let currentPlaybackId = 0;
let requestedClip: ClipName = 'IDLE';
let requestedPlaybackId = 0;
const actions = new Map<ClipName, THREE.AnimationAction>();

function send(type: string, detail: Record<string, unknown> = {}) {
  window.ReactNativeWebView?.postMessage(JSON.stringify({type, ...detail}));
}

function resize() {
  const width = Math.max(1, window.innerWidth, host.clientWidth);
  const height = Math.max(1, window.innerHeight, host.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function playClip(clip: ClipName, playbackId: number) {
  requestedClip = clip;
  requestedPlaybackId = playbackId;
  const nextAction = actions.get(clip);
  if (nextAction == null) return;

  currentPlaybackId = playbackId;
  nextAction.reset();
  nextAction.enabled = true;
  nextAction.setEffectiveTimeScale(1);
  nextAction.setEffectiveWeight(1);
  nextAction.setLoop(THREE.LoopOnce, 1);
  nextAction.clampWhenFinished = true;

  if (currentAction != null && currentAction !== nextAction) {
    // Blend bone transforms from the exact pose currently visible. No blank frame
    // and no forced reset to the neutral pose between consecutive signs.
    currentAction.enabled = true;
    nextAction.crossFadeFrom(currentAction, 0.24, false);
  }
  nextAction.play();
  currentAction = nextAction;
}

window.playVozualClip = playClip;

const draco = new DRACOLoader();
draco.setDecoderPath('./draco/');
draco.setDecoderConfig({type: 'js'});
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
loader.load(
  './vozual_avatar.glb',
  (gltf) => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 2.15 / Math.max(size.y, 0.001);
    gltf.scene.scale.setScalar(scale);
    gltf.scene.position.set(-center.x * scale, -center.y * scale - 0.02, -center.z * scale);
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.frustumCulled = false;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const mobileMaterials = materials.map((material) => {
          // Character Creator's desktop head shader is more complex than the
          // glTF PBR material model. Blender exports its multiplier as black,
          // which turns the whole face into a glossy mask on Android. Keep the
          // authored clothing textures, but use a deterministic mobile skin
          // material for the head when that incompatible shader is detected.
          if (material.name.includes('Std_Skin_Head')) {
            return new THREE.MeshStandardMaterial({
              name: material.name,
              color: 0xb97858,
              roughness: 0.78,
              metalness: 0,
              side: THREE.DoubleSide,
            });
          }
          material.side = THREE.DoubleSide;
          material.needsUpdate = true;
          return material;
        });
        object.material = Array.isArray(object.material) ? mobileMaterials : mobileMaterials[0];
      }
    });
    scene.add(gltf.scene);
    mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      const name = clip.name.toUpperCase() as ClipName;
      if (name === 'IDLE' || name === 'HOLA' || name === 'GRACIAS') {
        actions.set(name, mixer.clipAction(clip));
      }
    }
    mixer.addEventListener('finished', (event) => {
      if (event.action !== currentAction) return;
      if (requestedClip !== 'IDLE') {
        send('ended', {playbackId: currentPlaybackId, clip: requestedClip});
      }
    });
    playClip(requestedClip, requestedPlaybackId);
    send('ready', {clips: [...actions.keys()]});
  },
  undefined,
  (error) => send('error', {message: error instanceof Error ? error.message : String(error)}),
);

function animate() {
  requestAnimationFrame(animate);
  mixer?.update(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
}

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(host);
resize();
animate();
