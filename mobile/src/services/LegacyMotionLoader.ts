import Ajv2020, {ErrorObject} from 'ajv/dist/2020';
import semanticSchemaV1 from '../../../schemas/motion-semantics-v1.schema.json';
import semanticSchemaV2 from '../../../schemas/motion-semantics-v2.schema.json';
import {MotionSemantic, SignMotion} from './CompactSignMotion';

export type LegacyMotionDocument = SignMotion & {
  version?: number;
  layout?: string;
  avatarProfile?: Record<string, unknown>;
};

const validator = new Ajv2020({allErrors: true, strict: true});
const validateSemanticV1 = validator.compile(semanticSchemaV1);
const validateSemanticV2 = validator.compile(semanticSchemaV2);

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map(error => {
    const path = error.instancePath || '$.semantic';
    return `${path} ${error.message ?? 'is invalid'}`;
  }).join('; ');
}

export function validateLegacyMotionSemantic(
  semantic: unknown,
  sourceName = 'motion',
): asserts semantic is MotionSemantic {
  const schemaVersion = semantic !== null && typeof semantic === 'object' && !Array.isArray(semantic)
    ? (semantic as Record<string, unknown>).schemaVersion
    : undefined;
  const validateSemantic = schemaVersion === 1 ? validateSemanticV1 : validateSemanticV2;

  if (!validateSemantic(semantic)) {
    throw new Error(`${sourceName} has invalid semantic metadata: ${formatErrors(validateSemantic.errors)}`);
  }
}

/** Parse a legacy source motion without changing its frame payload. */
export function parseLegacyMotionDocument(
  value: unknown,
  sourceName = 'motion',
): LegacyMotionDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${sourceName} must be a JSON object.`);
  }
  const document = value as Record<string, unknown>;
  if (document.semantic !== undefined) {
    validateLegacyMotionSemantic(document.semantic, sourceName);
  }
  return document as LegacyMotionDocument;
}
