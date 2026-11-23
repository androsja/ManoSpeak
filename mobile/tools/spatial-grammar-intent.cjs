'use strict';

const {RigCapabilityError} = require('./rig-capability-profile.cjs');
const {compileSpatialGrammarIntent} = require('./spatial-grammar-intent-v1.cjs');
const {compileSpatialGrammarIntentV2} = require('./spatial-grammar-intent-v2.cjs');

/** Dispatch only supported authoring schema versions; neither version emits executable motion. */
function compileSpatialGrammarAuthoringIntent(source, profile, temporalIntent) {
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || source.schema !== 'vozual.spatial-grammar-intent') {
    throw new RigCapabilityError('SCHEMA.INVALID_SPATIAL_INTENT', 'Invalid spatial grammar intent envelope', {
      schema: source?.schema,
    });
  }
  if (source.schemaVersion === 1) {
    if (temporalIntent !== undefined) {
      throw new RigCapabilityError('SCHEMA.TEMPORAL_BINDING_REQUIRES_V2', 'Temporal relation binding requires spatial intent v2');
    }
    return compileSpatialGrammarIntent(source, profile);
  }
  if (source.schemaVersion === 2) return compileSpatialGrammarIntentV2(source, profile, temporalIntent);
  throw new RigCapabilityError('SCHEMA.UNSUPPORTED_SPATIAL_INTENT_VERSION', 'Unsupported spatial grammar intent version', {
    schemaVersion: source.schemaVersion,
  });
}

module.exports = {compileSpatialGrammarAuthoringIntent};
