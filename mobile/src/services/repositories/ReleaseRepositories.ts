import type {
  ActiveReleasePointer,
  ReleaseArtifact,
  ReleaseFragment,
  ReleaseRootManifest,
  ReleaseSignEntry,
} from '../ReleaseCatalogContract';

/**
 * Read-side ports for published catalogue content. They intentionally expose
 * only already-published distribution documents, never authoring recipes,
 * recordings, consent records, or validation reports.
 */
export interface ReleaseCatalogRepository {
  getActiveRelease(languageId: string, locale: string): Promise<ActiveReleasePointer | undefined>;
  getRootManifest(pointer: ActiveReleasePointer): Promise<ReleaseRootManifest>;
  getFragment(releaseId: string, fragmentId: string): Promise<ReleaseFragment>;
}

/**
 * This is an authoring-side port. It must only be supplied to the compiler or
 * publisher process, never to the mobile runtime composition root.
 */
export interface RecipeRepository<CompilationInput> {
  getCompilationInput(recipeId: string): Promise<CompilationInput | undefined>;
}

export type DownloadedArtifact = Readonly<{
  reference: ReleaseArtifact;
  bytes: Uint8Array;
}>;

/** Fetches public, compiled artifacts by an already validated reference. */
export interface ArtifactRepository {
  download(reference: ReleaseArtifact): Promise<DownloadedArtifact>;
}

export type DownloadState = 'staged' | 'verified' | 'failed';

export type InstalledArtifact = Readonly<{
  artifact: ReleaseArtifact;
  localPath: string;
  state: DownloadState;
  verifiedAt?: string;
}>;

export type InstalledSignEntry = Readonly<{
  releaseId: string;
  entry: ReleaseSignEntry;
  artifacts: readonly InstalledArtifact[];
}>;

export type InstalledRelease = Readonly<{
  releaseId: string;
  languageId: string;
  locale: string;
  rootManifest: ReleaseRootManifest;
  installedAt: string;
}>;

export type ReleaseStage = Readonly<{
  release: InstalledRelease;
  entries: readonly InstalledSignEntry[];
}>;

/**
 * Local read model used by playback. It owns only manifests, verified download
 * metadata and private device paths. Raw artifact bytes remain in the file
 * layer, while source recipes never enter this interface.
 */
export interface InstalledLibraryRepository {
  getActiveRelease(languageId: string, locale: string): Promise<InstalledRelease | undefined>;
  getInstalledSign(releaseId: string, signId: string): Promise<InstalledSignEntry | undefined>;
  beginStage(release: InstalledRelease): Promise<void>;
  stageEntry(releaseId: string, entry: InstalledSignEntry): Promise<void>;
  activateStage(releaseId: string): Promise<void>;
  rollbackActiveRelease(languageId: string, locale: string, releaseId: string): Promise<void>;
  discardStage(releaseId: string): Promise<void>;
}

type LibraryTables = {
  activeReleaseIds: Record<string, string>;
  releases: Record<string, InstalledRelease>;
  installedEntries: Record<string, Record<string, InstalledSignEntry>>;
  stages: Record<string, ReleaseStage>;
};

export interface LocalLibraryDatabase {
  transaction<T>(operation: (tables: LibraryTables) => T | Promise<T>): Promise<T>;
}

function cloneTables(tables: LibraryTables): LibraryTables {
  return {
    activeReleaseIds: {...tables.activeReleaseIds},
    releases: {...tables.releases},
    installedEntries: Object.fromEntries(Object.entries(tables.installedEntries).map(([releaseId, entries]) => [releaseId, {...entries}])),
    stages: Object.fromEntries(Object.entries(tables.stages).map(([releaseId, stage]) => [releaseId, {
      release: stage.release,
      entries: [...stage.entries],
    }])),
  };
}

function releaseKey(languageId: string, locale: string): string {
  return `${languageId}:${locale}`;
}

function emptyTables(): LibraryTables {
  return {activeReleaseIds: {}, releases: {}, installedEntries: {}, stages: {}};
}

/**
 * A serial, all-or-nothing database adapter suitable for tests and for a
 * future SQLite/Realm bridge. Its tables are deliberately separate; it is not
 * a growing monolithic library.json document.
 */
export class InMemoryLocalLibraryDatabase implements LocalLibraryDatabase {
  private tables = emptyTables();
  private tail: Promise<void> = Promise.resolve();

  async transaction<T>(operation: (tables: LibraryTables) => T | Promise<T>): Promise<T> {
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    const candidate = cloneTables(this.tables);
    try {
      const result = await operation(candidate);
      this.tables = candidate;
      return result;
    } finally {
      unlock();
    }
  }
}

/**
 * Transactional implementation. A release becomes visible only after every
 * staged entry has been verified, and activation replaces the active pointer
 * in the same local transaction.
 */
export class TransactionalInstalledLibraryRepository implements InstalledLibraryRepository {
  constructor(private readonly database: LocalLibraryDatabase) {}

  async getActiveRelease(languageId: string, locale: string): Promise<InstalledRelease | undefined> {
    return this.database.transaction(tables => {
      const releaseId = tables.activeReleaseIds[releaseKey(languageId, locale)];
      return releaseId ? tables.releases[releaseId] : undefined;
    });
  }

  async getInstalledSign(releaseId: string, signId: string): Promise<InstalledSignEntry | undefined> {
    return this.database.transaction(tables => tables.installedEntries[releaseId]?.[signId]);
  }

  async beginStage(release: InstalledRelease): Promise<void> {
    await this.database.transaction(tables => {
      if (tables.stages[release.releaseId]) throw new Error(`Release ${release.releaseId} is already staged.`);
      tables.stages[release.releaseId] = {release, entries: []};
    });
  }

  async stageEntry(releaseId: string, entry: InstalledSignEntry): Promise<void> {
    await this.database.transaction(tables => {
      const stage = tables.stages[releaseId];
      if (!stage) throw new Error(`Release ${releaseId} has no active stage.`);
      if (entry.releaseId !== releaseId) throw new Error('An installed entry must belong to its staged release.');
      if (entry.artifacts.length === 0 || entry.artifacts.some(artifact => artifact.state !== 'verified')) {
        throw new Error('Only entries with verified artifacts can be staged.');
      }
      const bySign = new Map(stage.entries.map(item => [item.entry.id, item]));
      bySign.set(entry.entry.id, entry);
      tables.stages[releaseId] = {...stage, entries: [...bySign.values()]};
    });
  }

  async activateStage(releaseId: string): Promise<void> {
    await this.database.transaction(tables => {
      const stage = tables.stages[releaseId];
      if (!stage) throw new Error(`Release ${releaseId} has no active stage.`);
      if (stage.entries.length === 0) throw new Error('A release without verified entries cannot be activated.');
      const entryTable = Object.fromEntries(stage.entries.map(entry => [entry.entry.id, entry]));
      tables.releases[releaseId] = stage.release;
      tables.installedEntries[releaseId] = entryTable;
      tables.activeReleaseIds[releaseKey(stage.release.languageId, stage.release.locale)] = releaseId;
      delete tables.stages[releaseId];
    });
  }

  async rollbackActiveRelease(languageId: string, locale: string, releaseId: string): Promise<void> {
    await this.database.transaction(tables => {
      const release = tables.releases[releaseId];
      if (!release || release.languageId !== languageId || release.locale !== locale) {
        throw new Error(`Release ${releaseId} is not installed for ${languageId}/${locale}.`);
      }
      tables.activeReleaseIds[releaseKey(languageId, locale)] = releaseId;
    });
  }

  async discardStage(releaseId: string): Promise<void> {
    await this.database.transaction(tables => { delete tables.stages[releaseId]; });
  }
}

/** Temporary narrow bridge for the existing SignLanguageService library. */
export type LegacyInstalledMotion = Readonly<{
  id: string;
  languageId: string;
  localPath: string;
  sha256: string;
  sizeBytes: number;
}>;

export interface LegacyInstalledLibraryReader {
  getInstalledMotion(signId: string): Promise<LegacyInstalledMotion | undefined>;
}

export class LegacyInstalledLibraryAdapter {
  constructor(private readonly legacy: LegacyInstalledLibraryReader) {}

  async getVerifiedMotion(signId: string, expected: ReleaseArtifact): Promise<InstalledArtifact | undefined> {
    if (expected.kind !== 'motion-binary') return undefined;
    const motion = await this.legacy.getInstalledMotion(signId);
    if (!motion || motion.sha256.toLowerCase() !== expected.sha256.toLowerCase() || motion.sizeBytes !== expected.sizeBytes) {
      return undefined;
    }
    return {artifact: expected, localPath: motion.localPath, state: 'verified'};
  }
}
