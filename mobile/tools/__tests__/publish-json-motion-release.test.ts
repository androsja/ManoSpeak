const fs = require('fs') as typeof import('fs');
const os = require('os') as typeof import('os');
const path = require('path') as typeof import('path');
const crypto = require('crypto') as typeof import('crypto');
const {buildRelease} = require('../publish-json-motion-release.cjs') as {
  buildRelease: (
    releaseId: string,
    version: number,
    glosses: string[],
    inputs: {motionDirectory: string; catalogPath: string},
  ) => {
    manifest: {phrases: Array<{id: string; spanish: string; glossSequence: string[]}>};
    signs: Array<{metadata: {
      speechAliases: string[];
      jsonCompression: string;
      compressedSizeBytes: number;
      sizeBytes: number;
    }; compressedChunks: string[]}>;
  };
};

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

describe('JSON motion release speech metadata', () => {
  it('publishes curated numeral and verb aliases separately from each JSON motion', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vozual-json-release-'));
    const motionDirectory = path.join(root, 'motions');
    const catalogPath = path.join(root, 'approved-signs.firestore.json');
    fs.mkdirSync(motionDirectory);
    const avatarProfile = {activeHand: 'left'};
    for (const gloss of ['UNO', 'COMER']) {
      fs.writeFileSync(path.join(motionDirectory, `${gloss.toLowerCase()}.motion.json`), JSON.stringify({
        version: 2,
        fps: 30,
        layout: 'pose33_left21_right21_face468',
        avatarProfile,
        frames: [{bodyHands: [], face: []}, {bodyHands: [], face: []}],
      }));
    }
    fs.writeFileSync(path.join(motionDirectory, 'sign-catalog.json'), JSON.stringify({
      entries: [
        {gloss: 'UNO', speechAliases: ['uno', '1']},
        {gloss: 'COMER', speechAliases: ['comer', 'come', 'comes', 'comía']},
      ],
    }));
    fs.writeFileSync(catalogPath, JSON.stringify({
      signs: ['UNO', 'COMER'].map(gloss => ({
        id: `lsc-co-${gloss.toLowerCase()}`,
        data: {
          gloss,
          profileSha256: sha256(JSON.stringify(avatarProfile)),
          speechAliases: [],
          categories: gloss === 'UNO' ? ['numeros_cantidades'] : ['acciones'],
          lexicalClass: gloss === 'UNO' ? 'numeral' : 'verb',
          approved: true,
          compiled: true,
        },
      })),
      phrases: [
        {
          id: 'lsc-co-uno-comer',
          data: {
            languageId: 'lsc-co',
            version: 1,
            spanish: 'Uno, comer.',
            glossSequence: ['UNO', 'COMER'],
            releaseSha256: sha256('lsc-co-uno-comer'),
            approved: true,
          },
        },
        {
          id: 'lsc-co-falta-sena',
          data: {
            languageId: 'lsc-co',
            version: 1,
            spanish: 'Falta otra seña.',
            glossSequence: ['UNO', 'FALTA'],
            releaseSha256: sha256('lsc-co-falta-sena'),
            approved: true,
          },
        },
      ],
    }));

    try {
      const release = buildRelease('lsc-co-json-v4', 4, ['UNO', 'COMER'], {motionDirectory, catalogPath});

      expect(release.signs[0].metadata.speechAliases).toEqual(['uno', '1']);
      expect(release.signs[1].metadata.speechAliases).toEqual(['comer', 'come', 'comes', 'comía']);
      expect(release.signs[0].metadata.jsonCompression).toBe('gzip');
      expect(release.signs[0].compressedChunks).toHaveLength(1);
      expect(release.signs[0].metadata.compressedSizeBytes)
        .toBeLessThan(release.signs[0].metadata.sizeBytes);
      expect(release.manifest.phrases).toEqual([
        expect.objectContaining({
          id: 'lsc-co-uno-comer',
          spanish: 'Uno, comer.',
          glossSequence: ['UNO', 'COMER'],
        }),
      ]);
    } finally {
      fs.rmSync(root, {recursive: true, force: true});
    }
  });
});
