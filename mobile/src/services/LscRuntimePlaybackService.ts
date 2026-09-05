import {
  resolveInstalledSignPlan,
  type InstalledLinguisticSign,
} from './LinguisticCatalogService';
import {
  resolvePlayableLscPhrase,
  type InstalledLscAsset,
} from './LscPhraseAssetCatalogService';

export type RuntimeLscPlayback = {
  status: 'reviewed' | 'draft' | 'unsupported';
  glosses: string[];
  message: string;
};

type RuntimeInstalledSign = InstalledLscAsset & InstalledLinguisticSign;

const DRAFT_PREVIEW_MESSAGE =
  'Vista previa de desarrollo: esta animación todavía no tiene validación lingüística LSC.';

/**
 * Keeps the production trust boundary closed while allowing developers to
 * inspect downloaded draft motion assets. Release callers must pass false.
 */
export function resolveRuntimeLscPlayback(
  text: string,
  installedSigns: readonly RuntimeInstalledSign[],
  allowDraftPreview: boolean,
): RuntimeLscPlayback {
  const reviewed = resolvePlayableLscPhrase(text, installedSigns);
  if (reviewed.status === 'matched') {
    return {
      status: 'reviewed',
      glosses: [...reviewed.entry.lsc.glossSequence],
      message: '',
    };
  }

  if (allowDraftPreview) {
    const draft = resolveInstalledSignPlan(text, installedSigns);
    const glosses = draft.tokens.map(token => token.gloss);
    if (glosses.length > 0) {
      return {status: 'draft', glosses, message: DRAFT_PREVIEW_MESSAGE};
    }
  }

  return {status: 'unsupported', glosses: [], message: reviewed.message};
}
