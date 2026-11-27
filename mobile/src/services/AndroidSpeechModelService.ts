import RNFS from 'react-native-fs';

// Pin both artifacts to one immutable upstream revision. A changed or partial
// download is rejected before the native recognizer can read either file.
const REVISION = '05a9908f7571fd39c774445806dfb8189bcdb43d';
const BASE_URL = `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-fast-conformer-ctc-es-1424-int8/resolve/${REVISION}`;
const DIRECTORY = `${RNFS.ExternalDirectoryPath || RNFS.DocumentDirectoryPath}/sherpa-es`;
const FILES = [
  {
    name: 'model.onnx',
    source: 'model.int8.onnx',
    bytes: 131652445,
    sha256: '9539b206ba7cb46231e24eb1f1d7269370bfd45209c549d70e2bfd0e9f3b021a',
  },
  {
    name: 'tokens.txt',
    source: 'tokens.txt',
    bytes: 10871,
    sha256: '6191b4853e3654f053c42f6fd184ca53b402987aefdd6ff6baa68034d803ee85',
  },
] as const;

async function verified(path: string, bytes: number, sha256: string): Promise<boolean> {
  if (!await RNFS.exists(path)) return false;
  const stat = await RNFS.stat(path);
  if (Number(stat.size) !== bytes) return false;
  return (await RNFS.hash(path, 'sha256')).toLowerCase() === sha256;
}

let installation: Promise<void> | undefined;

export function ensureAndroidSpeechModel(onProgress: (percent: number) => void): Promise<void> {
  if (installation) return installation;
  installation = (async () => {
    await RNFS.mkdir(DIRECTORY);
    for (const file of FILES) {
      const destination = `${DIRECTORY}/${file.name}`;
      if (await verified(destination, file.bytes, file.sha256)) continue;
      const temporary = `${destination}.download`;
      if (await RNFS.exists(temporary)) await RNFS.unlink(temporary);
      try {
        const result = await RNFS.downloadFile({
          fromUrl: `${BASE_URL}/${file.source}`,
          toFile: temporary,
          progressInterval: 400,
          progress: ({bytesWritten, contentLength}) => {
            if (file.name === 'model.onnx' && contentLength > 0) {
              onProgress(Math.min(99, Math.floor(bytesWritten * 100 / contentLength)));
            }
          },
        }).promise;
        if (result.statusCode !== 200 || !await verified(temporary, file.bytes, file.sha256)) {
          throw new Error('El archivo de voz descargado está incompleto o no pasó la verificación.');
        }
        if (await RNFS.exists(destination)) await RNFS.unlink(destination);
        await RNFS.moveFile(temporary, destination);
      } finally {
        if (await RNFS.exists(temporary)) await RNFS.unlink(temporary);
      }
    }
    onProgress(100);
  })().finally(() => { installation = undefined; });
  return installation;
}
