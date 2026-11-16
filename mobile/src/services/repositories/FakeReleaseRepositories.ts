import type {
  ActiveReleasePointer,
  ReleaseArtifact,
  ReleaseFragment,
  ReleaseRootManifest,
} from '../ReleaseCatalogContract';
import type {
  ArtifactRepository,
  DownloadedArtifact,
  RecipeRepository,
  ReleaseCatalogRepository,
} from './ReleaseRepositories';

/** Deterministic test double; it performs no Firebase or Storage access. */
export class FakeReleaseCatalogRepository implements ReleaseCatalogRepository {
  constructor(
    private readonly pointer?: ActiveReleasePointer,
    private readonly root?: ReleaseRootManifest,
    private readonly fragments: Readonly<Record<string, ReleaseFragment>> = {},
  ) {}

  async getActiveRelease(languageId: string, locale: string): Promise<ActiveReleasePointer | undefined> {
    if (this.pointer?.languageId !== languageId || this.pointer.locale !== locale) return undefined;
    return this.pointer;
  }

  async getRootManifest(pointer: ActiveReleasePointer): Promise<ReleaseRootManifest> {
    if (!this.root || this.root.releaseId !== pointer.releaseId) throw new Error('Root manifest is not available in fake repository.');
    return this.root;
  }

  async getFragment(releaseId: string, fragmentId: string): Promise<ReleaseFragment> {
    const fragment = this.fragments[`${releaseId}:${fragmentId}`];
    if (!fragment) throw new Error(`Fragment ${releaseId}/${fragmentId} is not available in fake repository.`);
    return fragment;
  }
}

export class FakeArtifactRepository implements ArtifactRepository {
  constructor(private readonly objects: Readonly<Record<string, Uint8Array>>) {}

  async download(reference: ReleaseArtifact): Promise<DownloadedArtifact> {
    const bytes = this.objects[reference.storagePath];
    if (!bytes) throw new Error(`Artifact ${reference.storagePath} is not available in fake repository.`);
    return {reference, bytes};
  }
}

export class FakeRecipeRepository<CompilationInput> implements RecipeRepository<CompilationInput> {
  constructor(private readonly recipes: Readonly<Record<string, CompilationInput>>) {}

  async getCompilationInput(recipeId: string): Promise<CompilationInput | undefined> {
    return this.recipes[recipeId];
  }
}
