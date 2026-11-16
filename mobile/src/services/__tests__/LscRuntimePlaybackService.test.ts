jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
}));

import {resolveRuntimeLscPlayback} from '../LscRuntimePlaybackService';
import {
  LSC_PHRASE_ASSET_CATALOG,
  type LscPhraseAssetCatalog,
} from '../LscPhraseAssetCatalogService';

const CHECKSUM = 'a'.repeat(64);
const installedHola = {id: 'clip.greeting.hello.v1', gloss: 'HOLA_REVIEWED', sha256: CHECKSUM};
const reviewedCatalog: LscPhraseAssetCatalog = {
  ...LSC_PHRASE_ASSET_CATALOG,
  entries: [{
    id: 'greeting.hello',
    status: 'active',
    spanish: {variants: ['hola', 'buenas'], intendedMeaning: 'Greeting another person'},
    lsc: {glossSequence: ['HOLA_REVIEWED'], regionalVariant: 'Colombia'},
    clips: [{id: installedHola.id, sha256: CHECKSUM}],
    licence: {status: 'verified', recordId: 'licence-1'},
    performerConsent: {status: 'granted', recordId: 'consent-1', version: '1'},
    review: {status: 'approved', reviewerId: 'reviewer-1', version: '1', reviewedAt: '2026-09-04T00:00:00Z'},
  }],
};

describe('LSC runtime playback policy', () => {
  it('keeps the production catalogue closed even when an individual asset is installed', () => {
    expect(resolveRuntimeLscPlayback('hola', [installedHola])).toEqual(
      expect.objectContaining({status: 'unsupported', glosses: []}),
    );
  });

  it('plays only the exact active reviewed phrase with its verified installed clip', () => {
    expect(resolveRuntimeLscPlayback('  ¡HOLA! ', [installedHola], reviewedCatalog)).toEqual(
      expect.objectContaining({status: 'reviewed', glosses: ['HOLA_REVIEWED'], message: ''}),
    );
  });

  it('rejects a reviewed phrase when its installed asset fails checksum verification', () => {
    expect(resolveRuntimeLscPlayback(
      'hola',
      [{...installedHola, sha256: 'b'.repeat(64)}],
      reviewedCatalog,
    )).toEqual(expect.objectContaining({status: 'unsupported', glosses: []}));
  });
});
