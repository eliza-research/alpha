import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {compileKotlin, kotlinJars} from '../../../../test/fixtures/kotlin-tools.mjs';
import {javaBinary} from '../../../../test/fixtures/jvm-tools.mjs';
import {root} from './java.mjs';

function declaration(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0 && source.indexOf(marker, start + marker.length) < 0, marker);
  const opening = source.indexOf('{', start);
  let depth = 1, end = opening + 1;
  for (; end < source.length && depth; end++) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
  }
  assert.equal(depth, 0, marker);
  return source.slice(start, end);
}

/** Execute the production Kotlin touch router with bounded Android input ports. */
export async function checkBrowserUnderlay(extraSources = []) {
  const implementation = join(root, 'vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/BelowHostLayer.kt');
  const template = fileURLToPath(new URL('./BrowserUnderlayTraces.kt.txt', import.meta.url));
  const sources = [implementation, template, fileURLToPath(import.meta.url),
    join(root, 'test/fixtures/kotlin-tools.mjs'), join(root, 'test/fixtures/jvm-tools.mjs'),
    join(root, 'android/gradle/verification-metadata.xml'), join(root, 'upstream.lock.json'),
    ...kotlinJars(), ...extraSources];
  const before = captureInputs(sources);
  const source = readFileSync(implementation, 'utf8');
  const start = source.indexOf('    private var touchTarget:');
  const end = source.indexOf('    override fun dispatchHoverEvent', start);
  assert.ok(start >= 0 && end > start, 'production touch-router observation boundary');
  const admissionStart = source.indexOf('internal fun takesPageInput(');
  const admissionEnd = source.indexOf('\n\n', admissionStart);
  assert.ok(admissionStart >= 0 && admissionEnd > admissionStart, 'production input admission');
  const generated = readFileSync(template, 'utf8')
    .replace('// LAYER_BODY', declaration(source, 'internal enum class SurfaceLayer') + '\n' + source.slice(admissionStart, admissionEnd))
    .replace('// ROUTER_BODY', source.slice(start, end));
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-underlay-refinement-'));
  try {
    const file = join(temporary, 'BrowserUnderlayTraces.kt');
    writeFileSync(file, generated);
    sources.push(file);
    const driverHashes = {...before, ...captureInputs([file])};
    const classpath = compileKotlin([file], temporary);
    const traces = JSON.parse(execFileSync(javaBinary('java'), ['-cp', classpath, 'BrowserUnderlayTracesKt'],
      {encoding: 'utf8', timeout: 30000}));
    return await checkTraces({model: 'BrowserUnderlay', sources, driverHashes, traces,
      generatedSources: [file], scope: 'bounded-component', assumptions: [
        'The unmodified production Kotlin touch-router fields, initialization, page selection, coordinate forwarding and dispatchTouchEvent execute on the JVM. Production takesPageInput gates the supplied page list.',
        'Only gesture ownership is observed. Android page visibility, selection, pause, disposal and geometry are controlled ports; their plugin lifecycle transitions are not claimed by this projection.',
        'Withdrawal and its next input delivery form one observation. The actual router must issue exactly one CANCEL and consume later motion; it must not replay cancellation.',
        'Rounded geometry, split-touch delivery by Android, native drawing, pointer hover, drag/drop, and signed-device behavior remain separate native integration obligations.',
      ]});
  } finally {rmSync(temporary, {recursive: true, force: true});}
}
