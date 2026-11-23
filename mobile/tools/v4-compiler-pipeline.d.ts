export type CompilerPassId =
  | 'parse'
  | 'semantic-validation'
  | 'normalization'
  | 'expansion'
  | 'compatibility'
  | 'constraint-conformance'
  | 'sampling'
  | 'optimization'
  | 'signing'
  | 'packaging';

export interface V4DiagnosticSource {
  readonly schema: 'vozual.motion-source';
  readonly schemaVersion: 4;
  readonly purpose: 'rig-conformance';
  readonly id: string;
  readonly revision: number;
  readonly linguisticIntent: {
    readonly requiredRigCapabilities: readonly string[];
    readonly [key: string]: unknown;
  };
  readonly temporalGraph: {
    readonly nodes: readonly unknown[];
    readonly [key: string]: unknown;
  };
  readonly constraints: Readonly<Record<string, unknown>>;
  readonly rigRealizationOverrides: Readonly<Record<string, unknown>>;
  readonly provenanceAndReview: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface CompilerDiagnostic {
  readonly code: string;
  readonly pass: CompilerPassId;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface CompilerPassRecord {
  readonly id: CompilerPassId;
  readonly status: 'complete' | 'skipped' | 'deferred';
  readonly reason?: string;
  readonly expandedNodeCount?: number;
}

export interface V4DiagnosticCompilerIR {
  readonly schema: 'vozual.compiler-ir';
  readonly formatVersion: 1;
  readonly pass: 'validated-diagnostic-source';
  readonly source: Readonly<V4DiagnosticSource>;
  readonly sourceCanonicalJson: string;
  readonly sourceSha256: string;
  readonly requiredRigCapabilities: readonly string[];
  readonly constraints: Readonly<Record<string, unknown>>;
}

export interface CompilerPublicationCandidate {
  readonly schema: 'vozual.compiler-publication-candidate';
  readonly formatVersion: 1;
  readonly source: Readonly<{schema: string; schemaVersion: number; id: string; revision: number; sha256: string}>;
  readonly compiler: Readonly<{id: string; build: string; pipelineVersion: string}>;
  readonly compatibility: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly artifact: Readonly<{
    sha256: string;
    byteLength: number;
    contentAddressedKey: string;
    executionDisposition: 'diagnostic-only-no-motion-emitted';
  }>;
  readonly signing: Readonly<{status: 'unsigned'; required: true; authority: 'trusted-firebase-publisher'}>;
  readonly publication: Readonly<{status: 'not-published'; sideEffects: false; releaseEligible: false}>;
}

export interface V4DiagnosticCompileOutput {
  readonly typedIR: Readonly<V4DiagnosticCompilerIR>;
  readonly artifact: Readonly<Record<string, unknown>>;
  readonly artifactCanonicalJson: string;
  readonly artifactSha256: string;
  readonly report: Readonly<{
    schema: 'vozual.compiler-validation-report';
    formatVersion: 1;
    pipelineVersion: string;
    compiler: Readonly<{id: string; build: string}>;
    source: Readonly<{id: string; revision: number; sha256: string}>;
    rig: Readonly<Record<string, unknown>>;
    passes: readonly CompilerPassRecord[];
    diagnostics: readonly CompilerDiagnostic[];
    artifact: Readonly<Record<string, unknown>>;
    publicationCandidateSha256: string;
  }>;
  readonly reportCanonicalJson: string;
  readonly reportSha256: string;
  readonly publicationCandidate: Readonly<CompilerPublicationCandidate>;
  readonly publicationCandidateCanonicalJson: string;
  readonly publicationCandidateSha256: string;
}

export interface TemporalCompositionIntentV1 {
  readonly schema: 'vozual.temporal-composition-intent';
  readonly schemaVersion: 1;
  readonly id: string;
  readonly revision: number;
  readonly durationMs: number;
  readonly tracks: readonly Readonly<Record<string, unknown>>[];
  readonly execution: 'authoring-only-not-executable';
}

export interface TemporalAuthoringCompilerIR {
  readonly schema: 'vozual.compiler-ir';
  readonly formatVersion: 1;
  readonly pass: 'expanded-temporal-authoring';
  readonly source: Readonly<{schema: string; schemaVersion: number; id: string; revision: number; sha256: string}>;
  readonly sourceCanonicalJson: string;
  readonly sourceSha256: string;
  readonly durationMs: number;
  readonly timeline: readonly Readonly<Record<string, unknown>>[];
  readonly executionDisposition: 'authoring-only-not-executable';
}

export interface TemporalAuthoringCompileOutput {
  readonly typedIR: Readonly<TemporalAuthoringCompilerIR>;
  readonly artifactCanonicalJson: string;
  readonly artifactSha256: string;
  readonly report: Readonly<Record<string, unknown>>;
  readonly reportCanonicalJson: string;
  readonly reportSha256: string;
}

export class CompilerPipelineError extends Error {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly code: string;
  readonly pass: CompilerPassId;
}

export const PIPELINE_VERSION: string;

export function compileV4DiagnosticPipeline(
  sourceInput: V4DiagnosticSource | string | Uint8Array,
  profile: Readonly<Record<string, unknown>>,
  candidateBytes: Uint8Array,
  options?: Readonly<Record<string, unknown>>,
): Readonly<V4DiagnosticCompileOutput>;

export function compileTemporalAuthoringIR(
  sourceInput: TemporalCompositionIntentV1 | string | Uint8Array,
): Readonly<TemporalAuthoringCompileOutput>;
