'use strict';

const Ajv2020 = require('ajv/dist/2020').default;

const validator = new Ajv2020({allErrors: true, strict: true});
const validateV1 = validator.compile(require('../../schemas/motion-semantics-v1.schema.json'));
const validateV2 = validator.compile(require('../../schemas/motion-semantics-v2.schema.json'));

function parseLegacyMotionDocument(value, sourceName = 'motion') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${sourceName} must be a JSON object.`);
  }
  const validateSemantic = value.semantic?.schemaVersion === 2 ? validateV2 : validateV1;
  if (value.semantic !== undefined && !validateSemantic(value.semantic)) {
    const errors = (validateSemantic.errors ?? []).map(error => (
      `${error.instancePath || '$.semantic'} ${error.message ?? 'is invalid'}`
    )).join('; ');
    throw new Error(`${sourceName} has invalid semantic metadata: ${errors}`);
  }
  return value;
}

module.exports = {parseLegacyMotionDocument};
