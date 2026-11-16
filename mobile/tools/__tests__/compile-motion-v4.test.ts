const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sourceProfile = require('../../../schemas/rig-profiles/vozual-rig-1.v2.json');
const {compileV4RigConformanceRecipe} = require('../compile-motion-v4.cjs');
const {profileSha256, restAxesInventorySha256} = require('../rig-capability-profile.cjs');
const {mechanicalConformanceContract, validateMechanicalConformanceProbes} = require('../rig-mechanical-conformance.cjs');
const isolatedCatalog = require('../../../schemas/rig-profiles/vozual-rig-1.isolated-probes.v2.json');
const {canonicalJson} = require('../rig-capability-profile.cjs');
const repositoryRoot = path.resolve(__dirname, '../../..');
const evidenceRoot = repositoryRoot;
const candidateBytesForProfile = fs.readFileSync(path.join(repositoryRoot,
  '.dwp/plans/PLAN_lsc_motion_dsl_v4/analysis_results/rig_candidates/748ed69abc902b01c694bfe685d0403baf0e4d1299abae5d07431bc5fc3de26a.glb'));

function compile(source: any, profile: any, candidateBytes: Buffer) {
  return compileV4RigConformanceRecipe(source, profile, candidateBytes, {evidenceRoot});
}

describe('v4 rig-conformance compiler', () => {
  function fixture(requiredRigCapabilities = ['arm.parentHierarchy']) {
    const candidateBytes = Buffer.from(candidateBytesForProfile);
    const profile = JSON.parse(JSON.stringify(sourceProfile));
    const source = {
      schema: 'vozual.motion-source',
      schemaVersion: 4,
      purpose: 'rig-conformance',
      id: 'rig-conformance-neutral',
      revision: 1,
      linguisticIntent: {requiredRigCapabilities},
      temporalGraph: {nodes: []},
      constraints: {reachabilityProbes: []},
      rigRealizationOverrides: {},
      provenanceAndReview: {technicalConformanceOnly: true},
    };
    return {candidateBytes, profile, source, evidenceRoot};
  }

  it('compiles deterministic bytes through an exact profile and asset binding', () => {
    const {candidateBytes, profile, source} = fixture();
    const first = compile(source, profile, candidateBytes);
    const second = compile(source, profile, candidateBytes);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.sha256).toBe(second.sha256);
    expect(first.artifact).toMatchObject({
      schema: 'vozual.runtime-execution-plan',
      compiler: {id: 'vozual-motion-v4', build: 'task3-rig-conformance-5'},
      rig: {
        profileId: profile.id,
        profileRevision: profile.revision,
        profileSha256: profile.sha256,
        candidateSha256: profile.asset.candidateSha256,
        restAxesInventorySha256: profile.descriptor.boneInventory.restAxesInventory.sha256,
        mechanicalObservationManifestSha256: profile.descriptor.mechanicalObservationEvidence.manifestSha256,
        mechanicalObservationReportRawSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        requiredCapabilities: ['arm.parentHierarchy'],
      },
      initialization: {
        neutralReferencePoseId: 'rest',
        referenceFrameSource: 'profile-neutral-rest',
      },
    });
    expect(first.artifact.conformanceDiagnostics.mechanicalObservation).toMatchObject({
      manifestSha256: profile.descriptor.mechanicalObservationEvidence.manifestSha256,
      reportRawSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      reportProjectionSha256: profile.descriptor.mechanicalObservationEvidence.reportProjectionSha256,
      candidateSha256: profile.asset.candidateSha256,
      restAxesInventorySha256: profile.descriptor.boneInventory.restAxesInventory.sha256,
      claim: 'observed-mechanical-response-only',
      disposition: 'provenance-only-no-executable-authorization',
      boneCount: 171,
      signedAxisSampleCount: 1026,
      samplesWithWeightedDisplacement: 1026,
    });
    expect(first.artifact.rig.requiredCapabilities).not.toContain('rig.mechanicalObservation');
    expect(first.artifact.frames).toEqual([]);
  });

  it('rejects unsupported capabilities and candidate bytes before emitting an artifact', () => {
    const unsupported = fixture(['arm.reachability']);
    expect(() => compile(unsupported.source, unsupported.profile, unsupported.candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    const supported = fixture();
    expect(() => compile(supported.source, supported.profile, Buffer.from('wrong candidate')))
      .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
  });

  it('fails closed when the local evidence root is not explicitly supplied', () => {
    const {candidateBytes, profile, source} = fixture();
    const previousRoot = process.env.VOZUAL_TASK3_14B_EVIDENCE_ROOT;
    delete process.env.VOZUAL_TASK3_14B_EVIDENCE_ROOT;
    try {
      expect(() => compileV4RigConformanceRecipe(source, profile, candidateBytes))
        .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    } finally {
      if (previousRoot === undefined) delete process.env.VOZUAL_TASK3_14B_EVIDENCE_ROOT;
      else process.env.VOZUAL_TASK3_14B_EVIDENCE_ROOT = previousRoot;
    }
  });

  it('fails an unreachable probe with measured bilateral diagnostics', () => {
    const {candidateBytes, profile, source} = fixture();
    source.constraints.reachabilityProbes = [{side: 'right', targetDistanceM: 0.8}];
    try {
      compile(source, profile, candidateBytes);
      throw new Error('expected an unreachable diagnostic');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'KINEMATIC.UNREACHABLE',
        details: {
          side: 'right',
          targetDistanceM: 0.8,
          maximumReachM: 0.653762,
          excessDistanceM: 0.146238,
          requiredCapability: 'arm.reachability',
          profileId: profile.id,
          profileRevision: profile.revision,
          profileSha256: profile.sha256,
        },
      });
    }
  });

  it('rejects motion nodes instead of implying later v4 compiler semantics', () => {
    const {candidateBytes, profile, source} = fixture();
    source.temporalGraph.nodes = [{id: 'future-node'}];
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({
        code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY',
        details: {requiredCapability: 'compiler.temporalGraph'},
      }));
  });

  it('binds discrete mechanical diagnostics without emitting motion frames', () => {
    const {candidateBytes, profile, source} = fixture();
    const pose = profile.descriptor.coordinateCalibration.endpointConformancePose;
    source.constraints.mechanicalPoseProbes = [{
      poseId: pose.id,
      rotationCommandsRad: Object.fromEntries(Object.entries(pose.rotationCommandsRad)
        .map(([bone, angle]) => [bone, [angle, 0, 0]])),
    }, {poseId: 'neutral-rest', rotationCommandsRad: {}}];
    const first = compile(source, profile, candidateBytes);
    expect(first.bytes.equals(compile(source, profile, candidateBytes).bytes)).toBe(true);
    expect(first.artifact.conformanceDiagnostics.mechanicalProbes).toMatchObject({
      contractSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      poseIds: [pose.id, 'neutral-rest'],
      disposition: 'diagnostic-only-no-motion-emitted',
    });
    expect(first.artifact.frames).toEqual([]);
    expect(first.artifact.rig.requiredCapabilities).toContain('endpoint.pointAnchors');
    expect(first.artifact.conformanceDiagnostics.mechanicalObservation.manifestSha256)
      .toBe(profile.descriptor.mechanicalObservationEvidence.manifestSha256);
  });

  it('accepts corrected diagnostic poses only for the exact evidenced candidate profile', () => {
    const mechanicalBasis = JSON.parse(JSON.stringify(sourceProfile));
    delete mechanicalBasis.descriptor.visualFidelityEvidence;
    expect(sourceProfile.sha256).toBe('c97937e3642cfae25dbbbb91fdd4ed62228ecc17d062a6c13443c556097ced54');
    expect(profileSha256(mechanicalBasis)).toBe('7651784cc5aa3b3f48fcbc0176e8ef50dd4728fabe73ef181c9662907f4324a0');
    expect(isolatedCatalog.profileSha256).toBe(profileSha256(mechanicalBasis));
    const contract = mechanicalConformanceContract(sourceProfile);
    const left = contract.configurations.find(pose => pose.id === 'corrected-hand-diagnostic-left-v1');
    const right = contract.configurations.find(pose => pose.id === 'corrected-hand-diagnostic-right-v1');
    expect(Object.keys(left.rotationCommandsRad)).toHaveLength(15);
    expect(left.rotationCommandsRad['DEF-thumb.01.L']).toEqual([0.15, 0, 0.2]);
    expect(right.rotationCommandsRad['DEF-thumb.01.R']).toEqual([0.15, 0, -0.1]);
    expect(validateMechanicalConformanceProbes(sourceProfile, [{poseId: left.id, rotationCommandsRad: left.rotationCommandsRad}]).poseIds).toEqual([left.id]);
    const changed = JSON.parse(JSON.stringify(left.rotationCommandsRad));
    changed['DEF-thumb.01.L'][2] += 0.001;
    expect(() => validateMechanicalConformanceProbes(sourceProfile, [{poseId: left.id, rotationCommandsRad: changed}]))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    const other = JSON.parse(JSON.stringify(sourceProfile));
    other.asset.candidateSha256 = '0'.repeat(64);
    other.descriptor.boneInventory.restAxesInventory.candidateSha256 = other.asset.candidateSha256;
    other.descriptor.boneInventory.restAxesInventory.sha256 = restAxesInventorySha256(other.descriptor.boneInventory.restAxesInventory);
    other.descriptor.mechanicalObservationEvidence.candidateSha256 = other.asset.candidateSha256;
    other.descriptor.mechanicalObservationEvidence.restAxesInventorySha256 = other.descriptor.boneInventory.restAxesInventory.sha256;
    other.sha256 = profileSha256(other);
    expect(mechanicalConformanceContract(other).configurations.some(pose => pose.id === left.id)).toBe(false);
  });

  it('accepts only exact non-colliding isolated measurements and rejects combinations', () => {
    const single = (v: number[]) => [{poseId: 'isolated-bone-probe-v1', rotationCommandsRad: {'DEF-f_index.01.L': v}}];
    expect(validateMechanicalConformanceProbes(sourceProfile, single([0.1, 0, 0])).poseIds).toEqual(['isolated-bone-probe-v1']);
    expect(() => validateMechanicalConformanceProbes(sourceProfile, single([0, 0, -0.1])))
      .toThrow(expect.objectContaining({code: 'KINEMATIC.DIAGNOSTIC_COLLISION', details: expect.objectContaining({overlapCount: 161})}));
    expect(() => validateMechanicalConformanceProbes(sourceProfile, single([0.101, 0, 0])))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    expect(() => validateMechanicalConformanceProbes(sourceProfile, single([0.1, 0.1, 0])))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    const otherProfile = JSON.parse(JSON.stringify(sourceProfile));
    otherProfile.asset.candidateSha256 = '0'.repeat(64);
    otherProfile.descriptor.boneInventory.restAxesInventory.candidateSha256 = otherProfile.asset.candidateSha256;
    otherProfile.descriptor.boneInventory.restAxesInventory.sha256 = restAxesInventorySha256(otherProfile.descriptor.boneInventory.restAxesInventory);
    otherProfile.descriptor.mechanicalObservationEvidence.candidateSha256 = otherProfile.asset.candidateSha256;
    otherProfile.descriptor.mechanicalObservationEvidence.restAxesInventorySha256 = otherProfile.descriptor.boneInventory.restAxesInventory.sha256;
    otherProfile.sha256 = profileSha256(otherProfile);
    expect(() => validateMechanicalConformanceProbes(otherProfile, single([0.1, 0, 0])))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    const tenDegrees = -10 * Math.PI / 180;
    expect(validateMechanicalConformanceProbes(sourceProfile,
      single([-10 * Math.PI / 180, 0, 0])).poseIds).toEqual(['isolated-bone-probe-v1']);
    expect(() => validateMechanicalConformanceProbes(sourceProfile,
      single([0, 0, tenDegrees])))
      .toThrow(expect.objectContaining({code: 'KINEMATIC.DIAGNOSTIC_COLLISION', details: expect.objectContaining({overlapCount: 156})}));

    const {candidateBytes, profile, source} = fixture();
    source.constraints.mechanicalPoseProbes = single([0.101, 0, 0]);
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
  });

  it('rejects a modified catalog even if its self-checksum is recomputed', () => {
    const sample = isolatedCatalog.bones['DEF-f_index.01.L'].x.find(item => item[0] === 0.1);
    const originalCount = sample[1];
    const originalSha = isolatedCatalog.sha256;
    try {
      sample[1] = originalCount + 1;
      const unsigned = {...isolatedCatalog};
      delete unsigned.sha256;
      isolatedCatalog.sha256 = crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
      expect(() => validateMechanicalConformanceProbes(sourceProfile, [{poseId: 'isolated-bone-probe-v1',
        rotationCommandsRad: {'DEF-f_index.01.L': [0.1, 0, 0]}}]))
        .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE'}));
    } finally {
      sample[1] = originalCount;
      isolatedCatalog.sha256 = originalSha;
    }
  });

  it('rejects an isolated catalog bound to a stale rest-axis inventory even if rehashed', () => {
    const originalInventorySha = isolatedCatalog.restAxesInventorySha256;
    const originalSha = isolatedCatalog.sha256;
    try {
      isolatedCatalog.restAxesInventorySha256 = '0'.repeat(64);
      const unsigned = {...isolatedCatalog};
      delete unsigned.sha256;
      isolatedCatalog.sha256 = crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
      expect(() => validateMechanicalConformanceProbes(sourceProfile, [{poseId: 'isolated-bone-probe-v1',
        rotationCommandsRad: {'DEF-f_index.01.L': [0.1, 0, 0]}}]))
        .toThrow(expect.objectContaining({code: 'COMPATIBILITY.RIG_PROFILE', message: expect.stringContaining('catalog checksum or binding mismatch')}));
    } finally {
      isolatedCatalog.restAxesInventorySha256 = originalInventorySha;
      isolatedCatalog.sha256 = originalSha;
    }
  });

  it.each([
    {poseId: 'neutral-rest', rotationCommandsRad: {'DEF-thumb.01.L': [0.1, 0, 0]}},
    {poseId: 'left-index-curl-v1', rotationCommandsRad: {'DEF-f_index.01.L': [0.15, 0, 0]}},
    {poseId: 'left-index-curl-v1', rotationCommandsRad: {
      'DEF-f_index.01.L': [0.15, 0.01, 0],
      'DEF-f_index.02.L': [0.2, 0, 0],
      'DEF-f_index.03.L': [0.15, 0, 0],
    }},
    {poseId: 'unknown-pose', rotationCommandsRad: {}},
  ])('rejects unsupported or combined mechanical configurations: %j', probe => {
    const {candidateBytes, profile, source} = fixture();
    source.constraints.mechanicalPoseProbes = [probe];
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
  });

  it('rejects malformed probes and previously ignored realizations or constraints', () => {
    const {candidateBytes, profile, source} = fixture();
    source.constraints.mechanicalPoseProbes = [];
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({code: 'SCHEMA.UNSUPPORTED_VERSION'}));
    delete source.constraints.mechanicalPoseProbes;
    source.rigRealizationOverrides = {boneRotations: {'DEF-thumb.01.L': 0.2}};
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
    source.rigRealizationOverrides = {};
    source.constraints.jointLimits = {minimum: -1, maximum: 1};
    expect(() => compile(source, profile, candidateBytes))
      .toThrow(expect.objectContaining({code: 'COMPILER.UNSUPPORTED_REQUIRED_CAPABILITY'}));
  });
});
