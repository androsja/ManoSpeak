const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const MOTION_DIRECTORY = path.join(MOBILE_ROOT, 'assets', 'motions');
const REPORT_DIRECTORY = path.join(MOBILE_ROOT, 'build', 'reports', 'avatar-visual-audit');
const MANIFEST_PATH = path.join(MOTION_DIRECTORY, 'published_signs.json');
const PROFILE_PATH = path.join(
  MOBILE_ROOT,
  'android',
  'app',
  'src',
  'main',
  'assets',
  'avatar',
  'motions',
  'avatar_profiles.json',
);

function argumentValue(name) {
  const prefix = `${name}=`;
  const value = process.argv.find(argument => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

function normalizedGloss(value) {
  return String(value).trim().normalize('NFC').toLocaleUpperCase('es-CO');
}

function safeFilename(value) {
  return normalizedGloss(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function adb(...arguments_) {
  return execFileSync('adb', arguments_, {encoding: 'utf8'}).trim();
}

function motionFilesByGloss() {
  const result = new Map();
  fs.readdirSync(MOTION_DIRECTORY)
    .filter(filename => filename.endsWith('.motion.json'))
    .forEach(filename => {
      const gloss = filename.slice(0, -'.motion.json'.length);
      result.set(normalizedGloss(gloss), path.join(MOTION_DIRECTORY, filename));
    });
  return result;
}

function selectedFrames(frameCount, profile) {
  const indexes = new Set([
    Math.round((frameCount - 1) * 0.25),
    Math.round((frameCount - 1) * 0.5),
    Math.round((frameCount - 1) * 0.75),
  ]);
  if (Number.isFinite(profile?.contactStartFrame)) indexes.add(profile.contactStartFrame);
  if (Number.isFinite(profile?.contactEndFrame)) indexes.add(profile.contactEndFrame);
  return [...indexes]
    .map(index => Math.max(0, Math.min(frameCount - 1, Math.round(index))))
    .sort((first, second) => first - second);
}

class DevToolsClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextIdentifier = 1;
    this.pending = new Map();
    this.socket.on('message', rawMessage => {
      const message = JSON.parse(String(rawMessage));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
  }

  send(method, params = {}) {
    const id = this.nextIdentifier;
    this.nextIdentifier += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.socket.send(JSON.stringify({id, method, params}));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text || 'WebView evaluation failed.');
    }
    return response.result?.value;
  }

  close() {
    this.socket.close();
  }
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitUntil(action, timeoutMilliseconds, description) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await action()) return;
    await wait(120);
  }
  throw new Error(`Timed out while waiting for ${description}.`);
}

async function devToolsPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`DevTools returned HTTP ${response.status}.`);
  const pages = await response.json();
  const page = pages.find(candidate => (
    candidate.type === 'page' && String(candidate.url).includes('/avatar/index.html')
  ));
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('The VOZUAL avatar WebView is not available. Open the Android app first.');
  }
  return page;
}

async function capture(client, outputPath) {
  // Chrome DevTools does not include Android's hardware-composited WebGL
  // surface in Page.captureScreenshot. Capture the real device surface so the
  // report contains the avatar exactly as the user sees it.
  void client;
  const screenshot = execFileSync('adb', ['exec-out', 'screencap', '-p']);
  fs.writeFileSync(outputPath, screenshot);
}

function writeHtmlReport(entries) {
  const cards = entries.map(entry => `
    <section>
      <h2>${entry.gloss} · frame ${entry.frame}</h2>
      <div class="pair">
        <figure><img src="${entry.points}" alt="${entry.gloss} points"><figcaption>PUNTOS</figcaption></figure>
        <figure><img src="${entry.rigged}" alt="${entry.gloss} character"><figcaption>PERSONAJE</figcaption></figure>
      </div>
    </section>`).join('\n');
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>VOZUAL · Auditoría visual</title>
<style>
body{margin:0;padding:24px;background:#07111f;color:#f5f8fc;font:16px system-ui,sans-serif}
h1{color:#20d6ce}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
section{margin:0 0 28px;padding:18px;background:#111e2e;border-radius:16px}
figure{margin:0}img{width:100%;background:#1d2939;border-radius:12px}figcaption{padding-top:8px;font-weight:800}
</style></head><body><h1>VOZUAL · Auditoría PUNTOS / PERSONAJE</h1>${cards}</body></html>`;
  fs.writeFileSync(path.join(REPORT_DIRECTORY, 'index.html'), html);
}

async function main() {
  const port = Number(argumentValue('--port') || 9333);
  const requested = (argumentValue('--signs') || '')
    .split(',')
    .map(normalizedGloss)
    .filter(Boolean);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const publishedGlosses = manifest.publishedGlosses.map(normalizedGloss);
  const glosses = requested.length > 0 ? requested : publishedGlosses;
  const profiles = fs.existsSync(PROFILE_PATH)
    ? JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'))
    : {};
  const motionFiles = motionFilesByGloss();

  const processIdentifier = adb('shell', 'pidof', 'com.androsja.vozual').split(/\s+/)[0];
  if (!processIdentifier) throw new Error('VOZUAL is not running on Android.');
  adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${processIdentifier}`);

  fs.mkdirSync(REPORT_DIRECTORY, {recursive: true});
  const page = await devToolsPage(port);
  const client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await waitUntil(
    () => client.evaluate('Boolean(window.playVozualClip && window.setVozualDebugFrame)'),
    10_000,
    'the VOZUAL avatar runtime',
  );

  const entries = [];
  let playbackIdentifier = 90_000;
  for (const gloss of glosses) {
    const motionPath = motionFiles.get(gloss);
    if (!motionPath) {
      console.warn(`Skipping ${gloss}: source motion JSON was not found.`);
      continue;
    }
    const motion = JSON.parse(fs.readFileSync(motionPath, 'utf8'));
    const frames = selectedFrames(motion.frames.length, profiles[gloss]);
    playbackIdentifier += 1;
    await client.evaluate(
      `window.playVozualClip(${JSON.stringify(gloss)}, ${playbackIdentifier}, 1, false); true;`,
    );
    await waitUntil(
      () => client.evaluate(`window.setVozualDebugFrame(${JSON.stringify(gloss)}, 0)`),
      10_000,
      `motion ${gloss}`,
    );

    for (const frame of frames) {
      const baseName = `${safeFilename(gloss)}-f${String(frame).padStart(3, '0')}`;
      const entry = {gloss, frame};
      for (const mode of ['points', 'rigged']) {
        await client.evaluate(
          `window.setVozualRenderMode('${mode}'); window.setVozualDebugFrame(${JSON.stringify(gloss)}, ${frame}); window.tickVozualAnimation(); true;`,
        );
        await wait(80);
        const filename = `${baseName}-${mode}.png`;
        await capture(client, path.join(REPORT_DIRECTORY, filename));
        entry[mode === 'points' ? 'points' : 'rigged'] = filename;
        if (mode === 'rigged') {
          entry.rigDiagnostics = await client.evaluate('window.getVozualRigDiagnostics?.()');
        }
      }
      entries.push(entry);
    }
    console.log(`${gloss}: ${frames.length} comparison frames captured.`);
  }

  writeHtmlReport(entries);
  fs.writeFileSync(
    path.join(REPORT_DIRECTORY, 'manifest.json'),
    JSON.stringify({capturedAt: new Date().toISOString(), entries}, null, 2),
  );
  client.close();
  console.log(`Visual report: ${path.join(REPORT_DIRECTORY, 'index.html')}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
