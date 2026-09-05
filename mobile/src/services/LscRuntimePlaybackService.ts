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
 * Firebase-installed signs have already passed the editor's approved,
 * compiled and published gate. They are therefore playable in release builds
 * as individual signs and ordered sign sequences. The phrase catalog remains
 * the stronger path for reviewed fixed expressions; development-only draft
 * preview is retained for assets that have not passed publication.
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

  const publishedPlan = resolveInstalledSignPlan(text, installedSigns);
  if (publishedPlan.tokens.length > 0 && publishedPlan.unavailableMarkers.length === 0) {
    return {
      status: 'reviewed',
      glosses: publishedPlan.tokens.map(token => token.gloss),
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
