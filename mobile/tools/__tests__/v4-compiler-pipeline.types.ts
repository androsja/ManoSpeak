import type {
  TemporalAuthoringCompileOutput,
  TemporalCompositionIntentV1,
  V4DiagnosticCompileOutput,
  V4DiagnosticSource,
} from '../v4-compiler-pipeline';

const source: V4DiagnosticSource = {
  schema: 'vozual.motion-source',
  schemaVersion: 4,
  purpose: 'rig-conformance',
  id: 'typed-compiler-input',
  revision: 1,
  linguisticIntent: {requiredRigCapabilities: []},
  temporalGraph: {nodes: []},
  constraints: {},
  rigRealizationOverrides: {},
  provenanceAndReview: {},
};

declare const output: V4DiagnosticCompileOutput;
declare const temporalSource: TemporalCompositionIntentV1;
declare const temporalOutput: TemporalAuthoringCompileOutput;

const sourceRevision: number = output.typedIR.source.revision;
const contentAddressedKey: string = output.publicationCandidate.artifact.contentAddressedKey;
const expandedSegmentCount: number = temporalOutput.typedIR.timeline.length;

void source;
void sourceRevision;
void contentAddressedKey;
void temporalSource;
void expandedSegmentCount;
