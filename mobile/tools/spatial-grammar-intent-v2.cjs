'use strict';

const {createHash} = require('crypto');
const Ajv2020 = require('ajv/dist/2020').default;
const schema = require('../../schemas/spatial-grammar-intent-v2.schema.json');
const classifierInventory = require('../../schemas/lsc-classifier-inventory-v1.json');
const modulationInventory = require('../../schemas/lsc-modulation-inventory-v1.json');
const {RigCapabilityError} = require('./rig-capability-profile.cjs');
const {compileSpatialGrammarIntent} = require('./spatial-grammar-intent-v1.cjs');
const {serializeTemporalAuthoringTimeline} = require('./temporal-composition-intent-v1.cjs');

const validateSchema = new Ajv2020({allErrors: true, strict: true}).compile(schema);
const classifierConstructionById = new Map(classifierInventory.constructions.map(construction => [construction.id, construction]));
const modulationVariantById = new Map(modulationInventory.variants.map(variant => [variant.id, variant]));

/**
 * Resolve provisional entity/locus links into immutable authoring provenance.
 * No relation is interpreted as linguistically reviewed or executable.
 */
function compileSpatialGrammarIntentV2(source, profile, temporalIntent) {
  if (!validateSchema(source)) {
    throw new RigCapabilityError('SCHEMA.INVALID_SPATIAL_INTENT_V2', 'Invalid spatial grammar intent v2', {errors: validateSchema.errors});
  }

  const {relations, temporalTimelineBinding, classifierAnnotations, modulationAnnotations, ...baseSource} = source;
  const baseTrace = compileSpatialGrammarIntent({...baseSource, schemaVersion: 1}, profile);
  const entityById = new Map(baseTrace.entities.map(entity => [entity.id, entity]));
  const locusById = new Map(baseTrace.loci.map(locus => [locus.id, locus]));
  const ids = new Set([...entityById.keys(), ...locusById.keys()]);
  const temporalContext = resolveTemporalContext(relations, temporalTimelineBinding, temporalIntent);

  const resolvedRelations = relations.map(relation => {
    if (ids.has(relation.id)) {
      throw new RigCapabilityError('SPATIAL.DUPLICATE_ID', 'Spatial record IDs must be globally unique', {
        id: relation.id, kind: 'relation',
      });
    }
    ids.add(relation.id);
    return {
      id: relation.id,
      kind: relation.kind,
      sourceRef: resolveReference(relation.sourceRef, 'sourceRef', relation.id, entityById, locusById),
      targetRef: resolveReference(relation.targetRef, 'targetRef', relation.id, entityById, locusById),
      ...(relation.temporalRefs ? {temporalRefs: resolveTemporalReferences(relation, temporalContext)} : {}),
      ...(relation.agreementRef ? {
        agreementRef: {
          ...relation.agreementRef,
          resolutionStatus: 'opaque-unverified',
        },
      } : {}),
    };
  }).sort((a, b) => compareText(a.id, b.id));
  const resolvedClassifierAnnotations = classifierAnnotations === undefined
    ? undefined
    : resolveClassifierAnnotations(classifierAnnotations, entityById, ids);
  const resolvedModulationAnnotations = modulationAnnotations === undefined
    ? undefined
    : resolveModulationAnnotations(modulationAnnotations, ids);

  return deepFreeze({
    schema: 'vozual.bound-spatial-authoring-trace',
    formatVersion: 2,
    source: {id: source.id, revision: source.revision, schemaVersion: 2},
    rigProfile: baseTrace.rigProfile,
    coordinateFrame: baseTrace.coordinateFrame,
    ...(temporalContext ? {temporalTimelineBinding: temporalContext.binding} : {}),
    execution: 'authoring-only-not-executable',
    linguisticReviewStatus: 'unreviewed',
    loci: baseTrace.loci,
    entities: baseTrace.entities,
    relations: resolvedRelations,
    ...(resolvedClassifierAnnotations === undefined ? {} : {classifierAnnotations: resolvedClassifierAnnotations}),
    ...(resolvedModulationAnnotations === undefined ? {} : {modulationAnnotations: resolvedModulationAnnotations}),
  });
}

function resolveModulationAnnotations(annotations, ids) {
  return annotations.map(annotation => {
    if (ids.has(annotation.id)) {
      throw new RigCapabilityError('SPATIAL.DUPLICATE_ID', 'Spatial record IDs must be globally unique', {
        id: annotation.id, kind: 'modulationAnnotation',
      });
    }
    ids.add(annotation.id);

    if (annotation.inventoryRevision !== modulationInventory.revision) {
      throw new RigCapabilityError('SPATIAL.INVALID_MODULATION_INVENTORY_REVISION', 'Modulation annotation references an unsupported inventory revision', {
        expected: modulationInventory.revision, actual: annotation.inventoryRevision,
      });
    }

    const variant = modulationVariantById.get(annotation.variantId);
    if (!variant) {
      throw new RigCapabilityError('SPATIAL.UNKNOWN_MODULATION_VARIANT', 'Modulation annotation references an unknown source-bounded variant', {
        variantId: annotation.variantId,
      });
    }

    const domainDecision = modulationInventory.domainDecisions.find(item => item.domain === variant.domain);
    if (!domainDecision || domainDecision.decision === 'not-an-independent-numeric-domain') {
      throw new RigCapabilityError('SPATIAL.UNSUPPORTED_MODULATION_DOMAIN', 'Modulation variant is not admitted by the documentary domain decisions', {
        variantId: variant.id, domain: variant.domain,
      });
    }
    if (variant.sourceSignGlosses.length > 0 && !variant.sourceSignGlosses.includes(annotation.sourceGloss)) {
      throw new RigCapabilityError('SPATIAL.MODULATION_GLOSS_MISMATCH', 'Declared sign gloss is outside the selected source-bounded variant', {
        variantId: variant.id,
        expected: variant.sourceSignGlosses,
        actual: annotation.sourceGloss,
      });
    }

    return {
      id: annotation.id,
      inventoryId: modulationInventory.id,
      inventoryRevision: modulationInventory.revision,
      variantId: variant.id,
      sourceGloss: annotation.sourceGloss,
      domain: variant.domain,
      operation: variant.operation,
      sourceSignGlosses: [...variant.sourceSignGlosses],
      semanticEffect: variant.semanticEffect,
      qualitativeParameters: structuredClone(variant.qualitativeParameters),
      evidence: structuredClone(variant.evidence),
      interpretationStatus: 'source-documented-pattern-not-instance-validated',
      signScopeStatus: variant.sourceSignGlosses.length > 0
        ? 'matches-source-listed-sign-scope'
        : 'requires-sign-specific-context-review',
      contextStatus: 'unreviewed',
    };
  }).sort((a, b) => compareText(a.id, b.id));
}

function resolveClassifierAnnotations(annotations, entityById, ids) {
  return annotations.map(annotation => {
    if (ids.has(annotation.id)) {
      throw new RigCapabilityError('SPATIAL.DUPLICATE_ID', 'Spatial record IDs must be globally unique', {
        id: annotation.id, kind: 'classifierAnnotation',
      });
    }
    ids.add(annotation.id);

    if (annotation.inventoryRevision !== classifierInventory.revision) {
      throw new RigCapabilityError('SPATIAL.INVALID_CLASSIFIER_INVENTORY_REVISION', 'Classifier annotation references an unsupported inventory revision', {
        expected: classifierInventory.revision, actual: annotation.inventoryRevision,
      });
    }

    const construction = classifierConstructionById.get(annotation.constructionId);
    if (!construction) {
      throw new RigCapabilityError('SPATIAL.UNKNOWN_CLASSIFIER_CONSTRUCTION', 'Classifier annotation references an unknown construction', {
        constructionId: annotation.constructionId,
      });
    }
    if (annotation.handshapeClass !== construction.handshapeClass) {
      throw new RigCapabilityError('SPATIAL.CLASSIFIER_HANDSHAPE_MISMATCH', 'Handshape class does not match the selected classifier construction', {
        constructionId: construction.id,
        expected: construction.handshapeClass,
        actual: annotation.handshapeClass,
      });
    }
    if (annotation.entityRef.role !== construction.role) {
      throw new RigCapabilityError('SPATIAL.CLASSIFIER_ROLE_MISMATCH', 'Entity reference role does not match the selected classifier construction', {
        constructionId: construction.id,
        expected: construction.role,
        actual: annotation.entityRef.role,
      });
    }
    if (annotation.entityRef.referentClass !== construction.referentClass) {
      throw new RigCapabilityError('SPATIAL.CLASSIFIER_REFERENT_MISMATCH', 'Entity reference referent class does not match the selected classifier construction', {
        constructionId: construction.id,
        expected: construction.referentClass,
        actual: annotation.entityRef.referentClass,
      });
    }

    const entity = entityById.get(annotation.entityRef.id);
    if (!entity) {
      throw new RigCapabilityError('SPATIAL.UNKNOWN_CLASSIFIER_ENTITY', 'Classifier annotation references an undeclared entity', {
        annotationId: annotation.id,
        entityId: annotation.entityRef.id,
      });
    }

    return {
      id: annotation.id,
      inventoryId: classifierInventory.id,
      inventoryRevision: classifierInventory.revision,
      constructionId: construction.id,
      handshapeClass: construction.handshapeClass,
      sourceHandshapeNotation: construction.sourceHandshapeNotation,
      representedReferent: construction.representedReferent,
      role: construction.role,
      entityRef: {
        kind: 'entity',
        id: entity.id,
        role: construction.role,
        referentClass: construction.referentClass,
        resolutionStatus: 'resolved-within-draft',
        record: structuredClone(entity),
      },
      contextStatus: 'unreviewed',
    };
  }).sort((a, b) => compareText(a.id, b.id));
}

/** Serialize the authoring trace deterministically; the digest covers trace bytes only. */
function serializeSpatialGrammarIntentV2(source, profile, temporalIntent) {
  const trace = compileSpatialGrammarIntentV2(source, profile, temporalIntent);
  const json = JSON.stringify(canonicalize(trace));
  const sha256 = createHash('sha256').update(json, 'utf8').digest('hex');
  return Object.freeze({json, sha256});
}

function resolveTemporalContext(relations, binding, temporalIntent) {
  const hasTemporalRefs = relations.some(relation => relation.temporalRefs !== undefined);
  if (!hasTemporalRefs) {
    if (binding || temporalIntent) {
      throw new RigCapabilityError('SPATIAL.UNUSED_TEMPORAL_BINDING', 'A temporal timeline binding and input are allowed only when a relation references timeline occurrences');
    }
    return null;
  }
  if (!binding) {
    throw new RigCapabilityError('SPATIAL.TEMPORAL_BINDING_REQUIRED', 'Relations with temporal references require an exact timeline binding');
  }
  if (!temporalIntent) {
    throw new RigCapabilityError('SPATIAL.TEMPORAL_TIMELINE_REQUIRED', 'Relations with temporal references require the matching temporal composition input');
  }
  if (!Number.isSafeInteger(binding.revision)) {
    throw new RigCapabilityError('SPATIAL.INVALID_TEMPORAL_BINDING', 'Temporal timeline revision must be a safe integer');
  }

  const serialized = serializeTemporalAuthoringTimeline(temporalIntent);
  const timeline = JSON.parse(serialized.json);
  if (binding.id !== timeline.source.id || binding.revision !== timeline.source.revision ||
      binding.sha256 !== serialized.sha256) {
    throw new RigCapabilityError('SPATIAL.TEMPORAL_TIMELINE_BINDING', 'Spatial intent is not bound to the exact temporal composition trace', {
      expected: {id: timeline.source.id, revision: timeline.source.revision, sha256: serialized.sha256},
      actual: binding,
    });
  }
  if (!Number.isSafeInteger(timeline.source.revision) || !Number.isSafeInteger(timeline.durationMs)) {
    throw new RigCapabilityError('SPATIAL.UNSAFE_TEMPORAL_RANGE', 'Temporal composition revision and duration must be safe integers');
  }

  const occurrences = new Map();
  for (const segment of timeline.timeline) {
    if (!Number.isSafeInteger(segment.fromMs) || !Number.isSafeInteger(segment.toMs) ||
        segment.fromMs < 0 || segment.toMs <= segment.fromMs || segment.toMs > timeline.durationMs) {
      throw new RigCapabilityError('SPATIAL.UNSAFE_TEMPORAL_RANGE', 'Referenced temporal spans must be positive safe-integer half-open ranges inside the composition', {
        trackId: segment.trackId, segmentId: segment.segmentId, fromMs: segment.fromMs, toMs: segment.toMs,
      });
    }
    const key = temporalOccurrenceKey(segment.trackId, segment.segmentId);
    if (occurrences.has(key)) {
      throw new RigCapabilityError('SPATIAL.AMBIGUOUS_TEMPORAL_REFERENCE', 'Temporal occurrence identity must be unique within the bound timeline', {
        trackId: segment.trackId, segmentId: segment.segmentId,
      });
    }
    occurrences.set(key, segment);
  }
  return {binding: {id: binding.id, revision: binding.revision, sha256: binding.sha256}, occurrences};
}

function resolveTemporalReferences(relation, temporalContext) {
  if (!temporalContext) {
    throw new RigCapabilityError('SPATIAL.TEMPORAL_TIMELINE_REQUIRED', 'A temporal timeline must be resolved before relation output is created', {
      relationId: relation.id,
    });
  }
  const seen = new Set();
  return relation.temporalRefs.map(reference => {
    const key = temporalOccurrenceKey(reference.trackId, reference.segmentId);
    if (seen.has(key)) {
      throw new RigCapabilityError('SPATIAL.DUPLICATE_TEMPORAL_REFERENCE', 'A relation cannot reference the same temporal occurrence more than once', {
        relationId: relation.id, trackId: reference.trackId, segmentId: reference.segmentId,
      });
    }
    seen.add(key);
    const segment = temporalContext.occurrences.get(key);
    if (!segment) {
      throw new RigCapabilityError('SPATIAL.UNKNOWN_TEMPORAL_REFERENCE', 'Relation references an undeclared temporal track occurrence', {
        relationId: relation.id, trackId: reference.trackId, segmentId: reference.segmentId,
      });
    }
    return {
      trackId: segment.trackId,
      segmentId: segment.segmentId,
      channel: segment.channel,
      phase: segment.phase,
      iteration: segment.iteration,
      fromMs: segment.fromMs,
      toMs: segment.toMs,
      resolutionStatus: 'resolved-within-bound-timeline',
    };
  }).sort((a, b) => a.fromMs - b.fromMs || compareText(a.trackId, b.trackId) || compareText(a.segmentId, b.segmentId));
}

function temporalOccurrenceKey(trackId, segmentId) {
  return `${trackId}\u0000${segmentId}`;
}

function resolveReference(reference, field, relationId, entityById, locusById) {
  const records = reference.kind === 'entity' ? entityById : locusById;
  const record = records.get(reference.id);
  if (!record) {
    throw new RigCapabilityError('SPATIAL.UNKNOWN_REFERENCE', 'Relation references an undeclared entity or locus', {
      relationId, field, kind: reference.kind, id: reference.id,
    });
  }
  return {
    kind: reference.kind,
    id: reference.id,
    resolutionStatus: 'resolved-within-draft',
    record: structuredClone(record),
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

module.exports = {compileSpatialGrammarIntentV2, serializeSpatialGrammarIntentV2};
