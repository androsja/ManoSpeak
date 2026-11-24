'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const {execFileSync, spawn} = require('child_process');
const {motionFor} = require('./generate-lsc-number-motion-drafts.cjs');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '..');
const OUTPUT_DIR = path.join(MOBILE_ROOT, 'assets/motions/drafts/creator');
const PREVIEW_OUTPUT_DIR = path.join(REPO_ROOT, 'tmp/vozual_creator_previews');
const DIEZ_MOTION_PATH = path.join(MOBILE_ROOT, 'assets/motions/drafts/numbers/diez.motion.json');
const PAGE_PATH = path.join(__dirname, 'vozual-json-creator.html');
const HOST = '127.0.0.1';
const PORT = Number(process.env.VOZUAL_CREATOR_PORT || 4174);
const FINGERS = new Set(['thumb', 'index', 'middle', 'ring', 'pinky']);
const FINGER_STATES = new Set(['captured', 'extended', 'closed']);
const previewRoots = new Map();

function fail(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}

function numberInRange(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${label} debe estar entre ${minimum} y ${maximum}.`);
  }
  return parsed;
}

function coordinate(point, axis, index, label) {
  const value = Array.isArray(point) ? point[index] : point?.[axis];
  return numberInRange(value, `${label} ${axis.toUpperCase()}`, index === 2 ? -1 : 0, 2);
}

function safeGloss(value) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 80
      || /[\/\\\0]/.test(value)) {
    fail('La seña necesita una glosa de 1 a 80 caracteres.');
  }
  return value.trim().toLocaleUpperCase('es-CO');
}

function safeFileId(gloss) {
  const ascii = gloss.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const result = ascii.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!result) fail('La glosa no produce un nombre de archivo válido.');
  return result;
}

function buildRuntimePreview(gloss, motion, baseName, handReference = false) {
  const previewRoot = path.join(PREVIEW_OUTPUT_DIR, baseName);
  const sourceDirectory = path.join(previewRoot, 'source');
  const runtimeDirectory = path.join(previewRoot, 'runtime');
  const runtimeMotions = path.join(runtimeDirectory, 'motions');
  if (fs.existsSync(previewRoot)) fs.rmSync(previewRoot, {recursive: true, force: true});
  fs.mkdirSync(sourceDirectory, {recursive: true});
  fs.mkdirSync(runtimeMotions, {recursive: true});

  const motionFileName = `${gloss.toLocaleLowerCase('es-CO')}.motion.json`;
  fs.writeFileSync(path.join(sourceDirectory, motionFileName), `${JSON.stringify(motion)}\n`);
  fs.writeFileSync(
    path.join(sourceDirectory, 'published_signs.json'),
    `${JSON.stringify({publishedGlosses: [gloss]}, null, 2)}\n`,
  );
  execFileSync(process.execPath, [
    path.join(MOBILE_ROOT, 'tools/compact-sign-motion.js'),
    sourceDirectory,
    runtimeMotions,
  ], {cwd: MOBILE_ROOT, stdio: 'pipe'});
  fs.writeFileSync(path.join(runtimeMotions, motionFileName), `${JSON.stringify(motion, null, 2)}\n`);

  const esbuild = path.join(MOBILE_ROOT, 'node_modules/.bin/esbuild');
  if (!fs.existsSync(esbuild)) {
    throw new Error('No se encontró esbuild. Ejecuta npm install dentro de mobile.');
  }
  execFileSync(esbuild, [
    'tools/avatar-runtime.ts',
    '--bundle',
    '--minify',
    '--format=iife',
    '--platform=browser',
    `--outfile=${path.join(runtimeDirectory, 'runtime.js')}`,
  ], {cwd: MOBILE_ROOT, stdio: 'pipe'});

  const previewTemplatePath = path.join(MOBILE_ROOT, 'tools/avatar/preview.html');
  const avatarModelPath = path.join(MOBILE_ROOT, 'assets/models/vozual_woman_avatar_hands_v4_mobile.glb');
  if (!fs.existsSync(previewTemplatePath) || !fs.existsSync(avatarModelPath)) {
    throw new Error('Falta la plantilla o el modelo 3D usado por la vista previa de Vozual.');
  }
  let previewHtml = fs.readFileSync(previewTemplatePath, 'utf8');
  const previewOnlyStyles = `
    <style>
      body.creator-preview { grid-template-columns: minmax(300px, 620px) minmax(270px, 420px); align-items: center; }
      body.creator-preview .visual-comparison { position: static; justify-content: center; }
      body.creator-preview .phone { height: min(82vh, 820px); }
      body.creator-preview .library,
      body.creator-preview .compilation-review,
      body.creator-preview .rig-editor,
      body.creator-preview .diagnosis,
      body.creator-preview .truth,
      body.creator-preview #source-video-panel,
      body.creator-preview #refresh-avatar,
      body.creator-preview #quick-refresh-avatar { display: none !important; }
      body.hand-pose-reference { height: 100dvh; min-height: 0; overflow: hidden; padding: 12px; grid-template-columns: minmax(300px, 1.2fr) minmax(320px, .8fr); gap: 12px; align-items: stretch; }
      body.hand-pose-reference .visual-comparison { position: static; justify-content: center; }
      body.hand-pose-reference .phone { height: calc(100dvh - 24px); min-height: 0; max-height: none; }
      body.hand-pose-reference .copy { min-height: 0; max-height: calc(100dvh - 24px); overflow-y: auto; scrollbar-width: none; align-self: stretch; padding: 0 8px; }
      body.hand-pose-reference .copy::-webkit-scrollbar { display: none; }
      body.hand-pose-reference .copy > :not(#title):not(#hand-pose-reference-panel) { display: none !important; }
      body.hand-pose-reference .copy #title { margin: 0 0 12px; font-size: 23px; }
      body.hand-pose-reference .hand-pose-reference-panel { display: block; }
      body.hand-pose-reference .timeline { display: block; position: static; margin: 12px 0; padding: 12px; }
      body.hand-pose-reference #seek { width: 100%; }
      body.hand-pose-reference #pose-reference-save-frame { width: 100%; min-height: 46px; margin-top: 8px; }
      body.hand-pose-reference[data-json-page="true"] { overflow: hidden; }
      body.hand-pose-reference[data-json-page="true"] .visual-comparison,
      body.hand-pose-reference[data-json-page="true"] .copy > :not(#hand-pose-reference-panel) { display: none !important; }
      body.hand-pose-reference #pose-reference-json-panel:not([hidden]) { position: fixed; inset: 0; z-index: 10000; display: flex; flex-direction: column; gap: 16px; overflow: auto; padding: clamp(16px, 4vw, 48px); background: #0a1220; }
      body.hand-pose-reference .pose-reference-json-toolbar { position: sticky; top: -1px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; background: #111e2e; border: 1px solid #31445a; border-radius: 12px; }
      body.hand-pose-reference .pose-reference-json-toolbar h1 { margin: 0; font-size: 22px; }
      body.hand-pose-reference #pose-reference-json-panel pre { flex: 1; min-height: 70vh; margin: 0; overflow: auto; white-space: pre; background: #07111f; color: #d8e6f5; border: 1px solid #31445a; border-radius: 12px; padding: 24px; font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size: 2; }
      body.hand-pose-reference .quick-avatar-refresh { display: none !important; }
      @media (max-width: 900px) {
        body.creator-preview { grid-template-columns: minmax(280px, 620px); }
        body.creator-preview .visual-comparison { justify-content: center; }
        body.hand-pose-reference { height: auto; min-height: 100dvh; overflow: auto; grid-template-columns: minmax(280px, 600px); }
        body.hand-pose-reference .phone { height: min(64vh, 620px); min-height: 440px; }
        body.hand-pose-reference .copy { width: 100%; max-height: none; overflow: visible; }
      }
    </style>`;
  previewHtml = previewHtml
    .replace('<title>VOZUAL · Simulación móvil</title>', '<title>VOZUAL Creator · Vista previa local</title>')
    .replace('</head>', `${previewOnlyStyles}\n  </head>`)
    .replace('<body>', `<body class="creator-preview${handReference ? ' hand-pose-reference' : ''}">`)
    .replace('SIMULACIÓN FIEL DE LA APP', 'VISTA PREVIA LOCAL · SIN PUBLICAR');
  fs.writeFileSync(path.join(runtimeDirectory, 'index.html'), previewHtml);
  fs.copyFileSync(avatarModelPath, path.join(runtimeDirectory, 'vozual_woman_avatar.glb'));
  fs.writeFileSync(path.join(runtimeDirectory, 'recordings.json'), '{}\n');
  previewRoots.set(baseName, runtimeDirectory);
  const referenceParameters = handReference
    ? (() => {
      const hand = motion.avatarProfile?.activeHand === 'right' ? 'right' : 'left';
      const offsets = hand === 'right'
        ? motion.avatarProfile?.rigRightFingerSpatialOffsets?.thumb
        : motion.avatarProfile?.rigLeftFingerSpatialOffsets?.thumb;
      return `&pose_reference=1${gloss === 'DIEZ' ? '&pose_reference_preset=fist' : ''}&hand=${hand}&palm_roll=${Number(motion.avatarProfile?.rigRightPalmAxialRollDegrees ?? motion.avatarProfile?.rigLeftPalmAxialRollDegrees) || 0}&finger=thumb&finger_lateral=${Number(offsets?.lateral) || 0}&finger_forward=${Number(offsets?.forward) || 0}`;
    })()
    : '';
  return `/preview/${baseName}/?gloss=${encodeURIComponent(gloss)}&creator_preview=1${referenceParameters}`;
}

function buildHandPoseReference(gloss) {
  const name = safeGloss(gloss || 'DIEZ');
  const motionPath = name === 'DIEZ' ? DIEZ_MOTION_PATH
    : path.join(MOBILE_ROOT, 'assets/motions', `${name.toLocaleLowerCase('es-CO')}.motion.json`);
  if (!fs.existsSync(motionPath)) fail(`No se encontró la seña ${name}.`);
  const motion = JSON.parse(fs.readFileSync(motionPath, 'utf8'));
  const baseName = name === 'DIEZ' ? 'hand-pose-reference' : `hand-pose-reference-${safeFileId(name)}`;
  const url = buildRuntimePreview(name, motion, baseName, true);
  return name === 'HOLA' ? `${url}&zoom=60&reference_frame=${motion.avatarProfile.contactStartFrame}` : url;
}

function normalizeAuthoringDocument(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('El borrador debe ser un objeto JSON.');
  const gloss = safeGloss(raw.gloss);
  const fingers = {};
  for (const finger of FINGERS) {
    const state = raw.fingers?.[finger];
    if (!FINGER_STATES.has(state)) fail(`Selecciona una configuración válida para ${finger}.`);
    fingers[finger] = state;
  }

  const aliases = Array.isArray(raw.speechAliases)
    ? raw.speechAliases.map(value => String(value).trim()).filter(Boolean)
    : [];
  const sourceTitle = String(raw.source?.title || '').trim();
  const sourceUrl = String(raw.source?.url || '').trim();
  if (sourceUrl && !sourceTitle) fail('Agrega el título de la referencia junto con su enlace.');
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) fail('La referencia debe ser una URL http o https.');

  const axes = ['x', 'y', 'z'];
  const wrist = axes.map((axis, index) => coordinate(raw.location?.wrist, axis, index, 'Muñeca'));
  const elbow = axes.map((axis, index) => coordinate(raw.location?.elbow, axis, index, 'Codo'));
  const sign = {
    gloss,
    speechAliases: [...new Set(aliases)],
    source: sourceTitle ? {title: sourceTitle, ...(sourceUrl ? {url: sourceUrl} : {})} : undefined,
    fingers,
    lateralFingerSpread: numberInRange(raw.lateralFingerSpread, 'Separación lateral', 0.5, 3),
    rigFingerSplayDegrees: numberInRange(raw.rigFingerSplayDegrees, 'Apertura del avatar', 0, 36),
    location: {wrist, elbow},
  };

  if (raw.movement?.type && raw.movement.type !== 'none') {
    const finger = String(raw.movement.finger || '');
    if (!FINGERS.has(finger)) fail('El movimiento debe seleccionar uno de los cinco dedos.');
    if (fingers[finger] === 'closed') fail('El dedo que se mueve debe estar extendido o marcado como controlado por movimiento.');
    const repetitions = numberInRange(raw.movement.repetitions, 'Repeticiones', 1, 8);
    const startFrame = numberInRange(raw.movement.startFrame, 'Inicio', 0, 300);
    const flexionFrames = numberInRange(raw.movement.flexionFrames, 'Duración al flexionar', 1, 120);
    const returnFrames = numberInRange(raw.movement.returnFrames, 'Duración al regresar', 1, 120);
    const pauseFrames = numberInRange(raw.movement.pauseFrames, 'Pausa', 0, 120);
    const holdFrames = numberInRange(raw.movement.holdFrames, 'Duración final', 0, 300);
    sign.movement = {
      type: 'finger-flexion-repetitions',
      finger,
      repetitions,
      startFrame,
      flexionFrames,
      returnFrames,
      pauseFrames,
      holdFrames,
      flexAmount: numberInRange(raw.movement.flexAmount, 'Intensidad de flexión', 0.05, 1),
    };
  }

  return {
    schema: 'vozual.sign-motion-authoring',
    schemaVersion: 1,
    status: 'draft',
    languageId: 'lsc-co',
    activeHand: 'left',
    ...sign,
  };
}

function createJsons(raw) {
  const authoring = normalizeAuthoringDocument(raw);
  const source = authoring.source ?? {title: 'Draft authored with VOZUAL Creator'};
  const sign = {
    ...authoring,
    location: {
      wrist: authoring.location.wrist,
      elbow: authoring.location.elbow,
    },
  };
  const motion = motionFor(sign, source, {generic: true});
  // Creator metadata belongs in the editable recipe. The mobile legacy loader
  // reserves motion.semantic for the separate, strict semantic-v1 contract.
  delete motion.semantic;
  const baseName = safeFileId(authoring.gloss);
  fs.mkdirSync(OUTPUT_DIR, {recursive: true});
  const authoringPath = path.join(OUTPUT_DIR, `${baseName}.authoring.json`);
  const motionPath = path.join(OUTPUT_DIR, `${baseName}.motion.json`);
  fs.writeFileSync(authoringPath, `${JSON.stringify(authoring, null, 2)}\n`);
  fs.writeFileSync(motionPath, `${JSON.stringify(motion)}\n`);
  let previewPath;
  let previewError;
  try {
    previewPath = buildRuntimePreview(authoring.gloss, motion, baseName);
  } catch (error) {
    previewError = error.message;
  }
  return {
    ok: true,
    gloss: authoring.gloss,
    authoringPath,
    motionPath,
    previewPath,
    previewError,
    frameCount: motion.frames.length,
  };
}

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
  response.writeHead(status, {'content-type': contentType, 'cache-control': 'no-store'});
  if (Buffer.isBuffer(body)) response.end(body);
  else response.end(contentType.startsWith('application/json') ? JSON.stringify(body) : body);
}

function servePreview(requestUrl, response) {
  const match = requestUrl.pathname.match(/^\/preview\/([a-z0-9-]+)(?:\/(.*))?$/);
  if (!match) return false;
  const gloss = requestUrl.searchParams.get('gloss');
  if (match[1] === 'hand-pose-reference' && !match[2] && gloss && gloss.toUpperCase() !== 'DIEZ') {
    response.writeHead(302, {location: `/hand-pose-reference?gloss=${encodeURIComponent(gloss)}`, 'cache-control': 'no-store'});
    response.end();
    return true;
  }
  const previewRoot = previewRoots.get(match[1]);
  if (!previewRoot) {
    send(response, 404, {ok: false, error: 'Genera los JSON de esta seña antes de abrir su vista previa.'});
    return true;
  }
  const relativePath = decodeURIComponent(match[2] || 'index.html');
  if (relativePath.startsWith('api/')) {
    send(response, 404, {ok: false, error: 'La vista de Creator es solo para reproducción local.'});
    return true;
  }
  const filePath = path.resolve(previewRoot, relativePath);
  if (!filePath.startsWith(`${previewRoot}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(response, 404, {ok: false, error: 'No se encontró el recurso de vista previa.'});
    return true;
  }
  const extension = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.bin': 'application/octet-stream',
    '.glb': 'model/gltf-binary',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  send(response, 200, fs.readFileSync(filePath), contentTypes[extension] || 'application/octet-stream');
  return true;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 100_000) {
        reject(Object.assign(new Error('El archivo de autoría es demasiado grande.'), {statusCode: 413}));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('La solicitud no contiene JSON válido.'), {statusCode: 400}));
      }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);
  if (request.method === 'GET' && servePreview(requestUrl, response)) return;
  if (request.method === 'GET' && requestUrl.pathname === '/hand-pose-reference') {
    try {
      response.writeHead(302, {
        location: buildHandPoseReference(requestUrl.searchParams.get('gloss')),
        'cache-control': 'no-store',
      });
      response.end();
    } catch (error) {
      send(response, 500, {ok: false, error: error.message});
    }
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/') {
    send(response, 200, fs.readFileSync(PAGE_PATH, 'utf8'), 'text/html; charset=utf-8');
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/create') {
    try {
      send(response, 200, createJsons(await readBody(request)));
    } catch (error) {
      send(response, error.statusCode || 400, {ok: false, error: error.message});
    }
    return;
  }
  send(response, 404, {ok: false, error: 'Ruta no encontrada.'});
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  process.stdout.write(`VOZUAL Creator listo: ${url}\nLos JSON se guardan en ${OUTPUT_DIR}\n`);
  if (process.platform === 'darwin' && process.env.VOZUAL_CREATOR_NO_OPEN !== '1') {
    const initialPath = process.argv.includes('--hand-pose-reference') ? '/hand-pose-reference' : '/';
    spawn('open', [`${url}${initialPath}`], {stdio: 'ignore', detached: true}).unref();
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
