'use strict';

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020').default;

const schema = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../schemas/motion-semantics-v1.schema.json'),
  'utf8',
));
const validator = new Ajv2020({allErrors: true, strict: true});
const validateSemantic = validator.compile(schema);

function parseLegacyMotionDocument(value, sourceName = 'motion') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${sourceName} must be a JSON object.`);
  }
  if (value.semantic !== undefined && !validateSemantic(value.semantic)) {
    const errors = (validateSemantic.errors ?? []).map(error => (
      `${error.instancePath || '$.semantic'} ${error.message ?? 'is invalid'}`
    )).join('; ');
    throw new Error(`${sourceName} has invalid semantic metadata: ${errors}`);
  }
  return value;
}

module.exports = {parseLegacyMotionDocument};
