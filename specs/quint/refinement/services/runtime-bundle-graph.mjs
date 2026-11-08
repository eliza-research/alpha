import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {verifyCoreStateBuildRecord,coreStateRequiredTargets} from '../../../../scripts/core-state-patch.mjs';

const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');

/** Derive portable input adjacency and qualified generated-source mappings from a successful producer receipt. */
export function writeRuntimeBundleGraph(root, source, observationPath, outputPath) {
  const observation = JSON.parse(fs.readFileSync(observationPath, 'utf8'));
  if (!observation.passed || !observation.inputsUnchanged || observation.builds.length !== 1) {
    throw Error('A successful, stable single-entry producer observation is required');
  }
  const build = observation.builds[0];
  verifyCoreStateBuildRecord(root, observation.coreState, coreStateRequiredTargets(build.firstParty.map(file => file.path)));
  if (hash(build.rawMetafile) !== build.rawMetafileSha256) throw Error('Raw mobile build metafile changed');
  const metadata = JSON.parse(fs.readFileSync(build.rawMetafile, 'utf8'));
  const byInput = new Map(build.firstParty.map(file => [file.input, file.path]));
  const require = createRequire(path.join(source, 'package.json'));
  const ts = require('typescript');
  const configurations = new Map();

  function generatedMapping(file) {
    const group = file.path.split('/').slice(0, 2).join('/');
    if (!configurations.has(group)) {
      const config = ['tsconfig.emit.json', 'tsconfig.build.json']
        .map(name => path.join(source, group, name)).find(fs.existsSync);
      const outputs = new Map();
      if (config) {
        const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, ts.sys);
        if (!parsed) throw Error(`Cannot parse emitted-source configuration ${config}`);
        for (const input of parsed.fileNames) {
          // Declaration-only or external inputs need not have a JavaScript output.
          if (input.endsWith('.d.ts')) continue;
          for (const output of ts.getOutputFileNames(parsed, input, true)) outputs.set(path.resolve(output), input);
        }
      }
      configurations.set(group, {config, outputs});
    }
    const {config, outputs} = configurations.get(group);
    const absolute = path.join(source, file.path);
    const original = outputs.get(absolute);
    const mapFile = absolute + '.map';
    const result = {};
    if (original) {
      result.method = 'declared-typescript-output-path';
      result.source = relative(source, original);
      result.sourceSha256 = hash(original);
      result.config = relative(source, config);
      result.configSha256 = hash(config);
    }
    if (fs.existsSync(mapFile)) {
      const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
      result.sourceMap = relative(source, mapFile);
      result.sourceMapSha256 = hash(mapFile);
      result.sourceMaps = (map.sources ?? []).map(name => path.resolve(path.dirname(mapFile), map.sourceRoot ?? '', name))
        .filter(fs.existsSync).map(file => ({path: relative(source, file), sha256: hash(file)}));
    }
    return result;
  }

  const files = {};
  let emitted = 0;
  let tracked = 0;
  let trackedEmitted = 0;
  let declaredOutput = 0;
  let sourceMapped = 0;
  let unmapped = 0;
  let firstPartyEdges = 0;
  let boundaryEdges = 0;
  for (const file of build.firstParty) {
    if (hash(path.join(source, file.path)) !== file.sha256) throw Error(`Compiled mobile input changed: ${file.path}`);
    if (file.bytesInOutput > 0) emitted++;
    if (file.tracked) tracked++;
    if (file.tracked && file.bytesInOutput > 0) trackedEmitted++;
    const generatedSource = file.tracked ? undefined : generatedMapping(file);
    if (generatedSource?.source) declaredOutput++;
    if (generatedSource?.sourceMaps?.length) sourceMapped++;
    if (generatedSource && !generatedSource.source && !generatedSource.sourceMaps?.length) unmapped++;
    const imports = (metadata.inputs[file.input].imports ?? []).map(imported => {
      const target = byInput.get(imported.path);
      if (target) firstPartyEdges++;
      else boundaryEdges++;
      return {target: target ?? imported.path, kind: imported.kind,
        scope: target ? 'first-party' : imported.external ? 'external' : metadata.inputs[imported.path] ? 'bundled-dependency' : 'virtual-or-unresolved'};
    });
    const transform = observation.coreState.transforms.find(row => row.path === file.path);
    if (transform && (file.sha256 !== transform.sourceSha256 || file.effectiveSourceSha256 !== transform.outputSha256)) throw Error('Core graph transformation differs from producer receipt');
    if (!transform && file.effectiveSourceSha256) throw Error('Unexpected effective-source transformation');
    files[file.path] = {sha256: file.sha256,
      ...(transform ? {effectiveSourceSha256: file.effectiveSourceSha256, transformation: file.transformation} : {}), bytesInOutput: file.bytesInOutput, tracked: file.tracked,
      ...(file.gitObject ? {gitObject: file.gitObject} : {}), ...(generatedSource ? {generatedSource} : {}), imports};
  }
  const generated = build.firstParty.length - tracked;
  const graph = {
    schema: 1, classification: 'observed-product-android-bundle-inputs', sourcePin: observation.sourcePin,
    producer: {script: 'scripts/build-mobile-agent.mjs', observer: relative(root, path.join(root, 'specs/quint/refinement/services/runtime-bundle-audit.mjs')),
      inputHashes: Object.fromEntries(Object.entries(observation.inputHashesBefore).map(([file, digest]) => [relative(root, file), digest])),
      coreState: observation.coreState, bun: observation.bun, bundleSha256: observation.bundleSha256, sourceTreeVerifiedBeforeAndAfter: true,
      inputHashesUnchanged: true, rawMetafileSha256: build.rawMetafileSha256, producerObservationSha256: hash(observationPath)},
    counts: {parsed: build.parsedInputs, firstParty: build.firstParty.length, emitted, tracked, generated,
      trackedEmitted, generatedEmitted: emitted - trackedEmitted, firstPartyEdges, boundaryEdges},
    generatedMappingCounts: {generated, declaredOutput, sourceMapped, unmapped},
    limitations: ['sha256 binds raw pinned source. effectiveSourceSha256, when present, binds authenticated post-patch source before compiler transformation, not emitted JavaScript.',
      'Parsed inputs with zero emitted contribution are marked separately.',
      'Generated-source maps and declared compiler output paths identify producer inputs and do not establish semantic equivalence or refinement.',
      'Compiled module inclusion does not establish runtime activation, model coverage or implementation refinement.',
      'External imports, runtime-computed imports and provider deployments remain contract boundaries.'],
    files,
  };
  fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2) + '\n');
  return graph;
}
