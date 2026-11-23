'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArguments(argv) {
  let draftPath;
  let profilePath;
  let timelinePath;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!['--draft', '--profile', '--timeline'].includes(option) || !value || value.startsWith('--')) {
      throw new Error('Usage: node compile-spatial-authoring-intent.cjs --draft <draft.json> --profile <profile.json> [--timeline <temporal-intent.json>]');
    }
    if (option === '--draft') {
      if (draftPath !== undefined) throw new Error('--draft may be specified only once');
      draftPath = value;
    } else if (option === '--profile') {
      if (profilePath !== undefined) throw new Error('--profile may be specified only once');
      profilePath = value;
    } else {
      if (timelinePath !== undefined) throw new Error('--timeline may be specified only once');
      timelinePath = value;
    }
    index += 1;
  }
  if (!draftPath || !profilePath) {
    throw new Error('Usage: node compile-spatial-authoring-intent.cjs --draft <draft.json> --profile <profile.json> [--timeline <temporal-intent.json>]');
  }
  return {draftPath, profilePath, timelinePath};
}

function readJson(filePath, label) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  try {
    return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label} JSON at ${resolvedPath}: ${error.message}`, {cause: error});
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

function main(argv) {
  try {
    const {draftPath, profilePath, timelinePath} = parseArguments(argv);
    const draft = readJson(draftPath, 'draft');
    const profile = readJson(profilePath, 'profile');
    const temporalIntent = timelinePath ? readJson(timelinePath, 'temporal composition') : undefined;
    const {compileSpatialGrammarAuthoringIntent} = require('./spatial-grammar-intent.cjs');
    const trace = compileSpatialGrammarAuthoringIntent(draft, profile, temporalIntent);
    const output = `${JSON.stringify(canonicalize(trace))}\n`;
    process.stdout.write(output);
  } catch (error) {
    const code = typeof error?.code === 'string' ? ` ${error.code}` : '';
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Spatial authoring compilation failed${code}: ${message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));
