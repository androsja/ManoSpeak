import {
  resolvePlayableLscPhrase,
  type InstalledLscAsset,
} from './LscPhraseAssetCatalogService';

export type RuntimeLscPlayback = {
  status: 'reviewed';
  glosses: string[];
  message: string;
} | {
  status: 'ambiguous';
  glosses: [];
  message: string;
  candidates: Array<{id: string; intendedMeaning: string}>;
} | {
  status: 'unsupported';
  glosses: [];
  message: string;
};

/**
 * The phrase catalogue is the runtime trust boundary. Installed assets alone
 * are never enough to animate the avatar: the exact confirmed Spanish phrase
 * must resolve to an active, reviewed entry whose ordered clips pass checksum
 * verification. This prevents a downloaded individual sign from becoming an
 * unreviewed word-for-word or approximate LSC translation.
 */
export function resolveRuntimeLscPlayback(
  text: string,
  installedSigns: readonly InstalledLscAsset[],
  catalog?: unknown,
  selectedEntryId?: string,
): RuntimeLscPlayback {
  const reviewed = resolvePlayableLscPhrase(text, installedSigns, catalog, selectedEntryId);
  if (reviewed.status === 'matched') {
    return {
      status: 'reviewed',
      glosses: [...reviewed.entry.lsc.glossSequence],
      message: '',
    };
  }
  if (reviewed.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      glosses: [],
      message: reviewed.message,
      candidates: reviewed.candidates,
    };
  }
  return {status: 'unsupported', glosses: [], message: reviewed.message};
}
