import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript-ast';
import {inspectJavaFiles, javaAuditInputs} from './quint-java-state-audit.mjs';

const mutableConstructors = /(?:Map|Set|WeakMap|WeakSet|Array|Promise|AbortController|Subject|EventEmitter|Queue|Cache|Store|Controller|Service)$/;
const hooks = /^(?:useState|useReducer|useRef|createStore|createSignal|signal|writable|ref|reactive)$/;
const mutations = new Set(['set', 'add', 'delete', 'clear', 'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'abort', 'resolve', 'reject']);
const asyncCalls = new Set(['then', 'catch', 'finally', 'addEventListener', 'removeEventListener', 'subscribe', 'unsubscribe', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'addListener', 'removeListener', 'on', 'off', 'once', 'listen', 'schedule', 'enqueue', 'dispatch', 'all', 'allSettled', 'race']);
const scriptKinds = {'.ts': ts.ScriptKind.TS, '.tsx': ts.ScriptKind.TSX, '.js': ts.ScriptKind.JS, '.jsx': ts.ScriptKind.JSX, '.mjs': ts.ScriptKind.JS};
const testSupportPath = /(?:^|\/)(?:__tests__|__mocks__|tests?|testing|test-mocks|androidTest|fixtures?)(?:\/|$)|\.(?:test|spec|bench|benchmark)\.[^.]+$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function writeReport(path, contents) {
  mkdirSync(dirname(path), {recursive: true});
  const temporary = mkdtempSync(join(dirname(path), '.quint-state-'));
  try {
    const staged = join(temporary, 'report.json');
    writeFileSync(staged, contents);
    renameSync(staged, path);
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
}

/** Syntactic candidates require source review before they become modeled state. */
export function inspectStateCandidates(path, text) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKinds[extname(path)]);
  const line = node => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const short = node => node.getText(file).replace(/\s+/g, ' ').slice(0, 180);
  const label = node => node.name ? short(node.name)
    : node.parent && (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)) ? short(node.parent.name)
    : `${ts.SyntaxKind[node.kind]}@${line(node)}`;
  function ownerOf(node) {
    const names = [];
    for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
      if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isFunctionLike(parent)) names.unshift(label(parent));
    }
    return names.join('.') || '<module>';
  }
  function classOwnerOf(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) {
        const outer = ownerOf(parent);
        return outer === '<module>' ? label(parent) : `${outer}.${label(parent)}`;
      }
    }
    return null;
  }
  function rootOf(node) {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ThisKeyword) return `this.${ts.isPropertyAccessExpression(node) ? node.name.text : short(node.argumentExpression)}`;
      return rootOf(node.expression);
    }
    return ts.isIdentifier(node) ? node.text : null;
  }
  function bindingNames(node) {
    if (ts.isIdentifier(node)) return [node.text];
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
      return node.elements.flatMap(element => ts.isBindingElement(element) ? bindingNames(element.name) : []);
    }
    return [];
  }
  function guardsOf(node) {
    const guards = [];
    for (let parent = node.parent; parent && !ts.isFunctionLike(parent); parent = parent.parent) {
      if (ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) guards.unshift(short(parent.expression));
      if (ts.isConditionalExpression(parent)) guards.unshift(short(parent.condition));
      if (ts.isCaseClause(parent)) guards.unshift(`case ${short(parent.expression)}`);
    }
    return guards.slice(-3);
  }
  function initializerReason(initializer) {
    if (!initializer) return null;
    if (ts.isAsExpression(initializer) || ts.isTypeAssertionExpression(initializer) || ts.isParenthesizedExpression(initializer) || ts.isNonNullExpression(initializer)) return initializerReason(initializer.expression);
    if (ts.isNewExpression(initializer) && mutableConstructors.test(short(initializer.expression))) return 'mutable-instance';
    if (ts.isCallExpression(initializer)) {
      const name = ts.isPropertyAccessExpression(initializer.expression) ? initializer.expression.name.text : short(initializer.expression);
      if (hooks.test(name)) return 'state-hook';
    }
    if (ts.isArrayLiteralExpression(initializer) || ts.isObjectLiteralExpression(initializer)) return 'mutable-container';
    return null;
  }
  const declarations = [], writes = [], asynchronous = [];
  function write(node, target, operation) {
    const root = rootOf(target);
    writes.push({line: line(node), owner: ownerOf(node), classOwner: classOwnerOf(node), root, target: short(target), operation, guards: guardsOf(node)});
  }
  function visit(node) {
    if (ts.isParameter(node) && node.modifiers?.some(modifier => [ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(modifier.kind))) {
      const primitive = node.type && [ts.SyntaxKind.StringKeyword, ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.BooleanKeyword, ts.SyntaxKind.BigIntKeyword, ts.SyntaxKind.SymbolKeyword].includes(node.type.kind);
      if (!primitive) declarations.push({line: line(node), owner: classOwnerOf(node), name: short(node.name), kind: 'class-field', reason: 'injected-reference', readonly: !!node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ReadonlyKeyword)});
    }
    if (ts.isPropertyDeclaration(node)) {
      const readonly = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ReadonlyKeyword);
      const reason = initializerReason(node.initializer);
      if (!readonly || reason) declarations.push({line: line(node), owner: ownerOf(node), name: short(node.name), kind: 'class-field', reason: reason || 'writable-field', readonly: !!readonly});
    }
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)) {
      const mutable = !(node.parent.flags & ts.NodeFlags.Const);
      const reason = initializerReason(node.initializer);
      for (const name of bindingNames(node.name)) declarations.push({line: line(node), owner: ownerOf(node), name, kind: 'binding', reason: mutable ? 'mutable-binding' : reason, readonly: !mutable});
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) write(node, node.left, ts.tokenToString(node.operatorToken.kind));
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) write(node, node.operand, ts.tokenToString(node.operator));
    if (ts.isCallExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : short(node.expression);
      if (ts.isPropertyAccessExpression(node.expression) && mutations.has(name)) write(node, node.expression.expression, `.${name}()`);
      if (asyncCalls.has(name)) asynchronous.push({line: line(node), owner: ownerOf(node), operation: name});
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const write of writes) {
    if (write.classOwner && write.root?.startsWith('this.')) {
      const name = write.root.slice(5);
      if (!declarations.some(item => item.owner === write.classOwner && item.name === name)) {
        declarations.push({line: write.line, owner: write.classOwner, name, kind: 'inferred-class-field', reason: 'property-write', readonly: false});
      }
    }
  }
  const matched = new Set();
  const candidates = declarations.flatMap(declaration => {
    const root = declaration.kind.endsWith('class-field') ? `this.${declaration.name}` : declaration.name;
    const related = writes.filter(write => write.root === root && (write.owner === declaration.owner || write.owner.startsWith(declaration.owner + '.') || declaration.owner === '<module>'));
    if (!declaration.reason && !related.length) return [];
    if (declaration.reason === 'mutable-container' && declaration.owner !== '<module>' && !related.length) return [];
    for (const write of related) matched.add(write);
    return [{...declaration, writes: related.map(({root, classOwner, ...write}) => write)}];
  });
  return {parseErrors: file.parseDiagnostics.map(error => ({line: file.getLineAndCharacterOfPosition(error.start ?? 0).line + 1, message: ts.flattenDiagnosticMessageText(error.messageText, '\n')})), candidates, asynchronous, writeSites: writes.length, unassignedWrites: writes.filter(write => !matched.has(write)).map(({root, classOwner, ...write}) => write)};
}

export function writeStateAudit(root) {
  const ledgerPath = resolve(root, 'specs/quint/coverage.json');
  const ledgerBytes = readFileSync(ledgerPath);
  const ledger = JSON.parse(ledgerBytes);
  const javaFiles = inspectJavaFiles(root, ledger.files.filter(entry => extname(entry.path) === '.java').map(entry => entry.path));
  const files = [];
  for (const entry of ledger.files) {
    const bytes = readFileSync(resolve(root, entry.path));
    assert.equal(digest(bytes), entry.sha256, `State audit needs current source bytes for ${entry.path}`);
    const java = javaFiles[entry.path];
    if (java) assert.equal(java.consumedSha256, entry.sha256, `Java parser needs current ledger bytes for ${entry.path}`);
    const parsed = scriptKinds[extname(entry.path)] !== undefined || !!java;
    files.push({path: entry.path, sha256: entry.sha256, allocatedModels: entry.models,
      sourceReview: entry.reviewStatus, sourcePathClass: testSupportPath.test(entry.path) ? 'test-support-path' : 'other-source-path', classification: parsed ? 'syntactic-candidates' : 'language-review-required',
      ...(java || (parsed ? inspectStateCandidates(entry.path, bytes.toString('utf8')) : {}))});
  }
  const report = {schemaVersion: 1, parser: {package: 'typescript-ast', version: ts.version, javaRelease: 21},
    javaAuditInputs: javaAuditInputs(),
    toolSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
    dependencyLockSha256: digest(readFileSync(resolve(root, 'package-lock.json'))), sourcePin: ledger.upstream.commit, ledgerSha256: digest(ledgerBytes),
    method: 'TypeScript syntax trees for JavaScript/TypeScript and JDK compiler trees for Java. Mutable fields, bindings, containers, state hooks, write sites and asynchronous registration calls are candidates for semantic review.',
    limitations: [
      'Candidate extraction does not establish state-machine coverage or implementation refinement.',
      'Bindings use syntactic owner/name matching. Aliases, computed mutation, external library state and closure escapes require source review.',
      'CSS conditions, Kotlin, data files and parse diagnostics remain explicit review work. Const containers and readonly fields may retain mutable contents.',
      'Test-support path classification is a review aid. Other source paths can also contain verification code or inactive runtime branches.',
      'The ledger supplies pinned source bytes. Effective client/native/runtime patch outputs require their separately authenticated source mappings.',
    ],
    counts: {files: files.length, testSupportFiles: files.filter(file => file.sourcePathClass === 'test-support-path').length,
      testSupportCandidates: files.filter(file => file.sourcePathClass === 'test-support-path').reduce((sum, file) => sum + (file.candidates?.length || 0), 0),
      parsedFiles: files.filter(file => file.candidates).length,
      languageReview: files.filter(file => !file.candidates).length,
      parseErrors: files.reduce((sum, file) => sum + (file.parseErrors?.length || 0), 0),
      candidates: files.reduce((sum, file) => sum + (file.candidates?.length || 0), 0),
      writeSites: files.reduce((sum, file) => sum + (file.writeSites || 0), 0),
      writeAssociations: files.reduce((sum, file) => sum + (file.candidates?.reduce((n, item) => n + item.writes.length, 0) || 0), 0),
      asynchronous: files.reduce((sum, file) => sum + (file.asynchronous?.length || 0), 0),
      unassignedWrites: files.reduce((sum, file) => sum + (file.unassignedWrites?.length || 0), 0)}, files};
  assert.equal(digest(readFileSync(ledgerPath)), report.ledgerSha256, 'Source ledger changed during state audit');
  for (const file of files) assert.equal(digest(readFileSync(resolve(root, file.path))), file.sha256, `Source changed during state audit ${file.path}`);
  const detailPath = 'test-results/quint-state-audit/details.json';
  const details = JSON.stringify(report, null, 2) + '\n';
  writeReport(resolve(root, detailPath), details);
  const summaryFiles = files.map(file => {
    const owners = new Map();
    for (const candidate of file.candidates || []) {
      const owner = owners.get(candidate.owner) || {owner: candidate.owner, line: candidate.line, bindings: 0, writes: 0};
      owner.line = Math.min(owner.line, candidate.line);
      owner.bindings++;
      owner.writes += candidate.writes.length;
      owners.set(candidate.owner, owner);
    }
    return {path: file.path, sha256: file.sha256, allocatedModels: file.allocatedModels,
      sourceReview: file.sourceReview, sourcePathClass: file.sourcePathClass, classification: file.classification,
      owners: [...owners.values()], parseErrors: file.parseErrors || [],
      asynchronous: file.asynchronous?.length || 0, unassignedWrites: file.unassignedWrites?.length || 0};
  });
  const summary = {...report, detail: {path: detailPath, sha256: digest(details)}, files: summaryFiles};
  writeReport(resolve(root, 'specs/quint/state-audit.json'), JSON.stringify(summary, null, 2) + '\n');
  return report.counts;
}

export function checkStateAudit(root) {
  const report = JSON.parse(readFileSync(resolve(root, 'specs/quint/state-audit.json')));
  const problems = [];
  const expected = {
    ledgerSha256: digest(readFileSync(resolve(root, 'specs/quint/coverage.json'))),
    dependencyLockSha256: digest(readFileSync(resolve(root, 'package-lock.json'))),
    toolSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
  };
  for (const [field, hash] of Object.entries(expected)) {
    if (report[field] !== hash) problems.push(`State audit needs regeneration after ${field} changed`);
  }
  for (const [path, hash] of Object.entries(javaAuditInputs())) {
    if (report.javaAuditInputs?.[path] !== hash) problems.push(`State audit Java parser changed ${path}`);
  }
  const details = resolve(root, report.detail.path);
  if (existsSync(details) && digest(readFileSync(details)) !== report.detail.sha256) problems.push('State audit detailed report changed');
  if (report.parser.version !== ts.version) problems.push('State audit parser version changed');
  for (const file of report.files) {
    if (digest(readFileSync(resolve(root, file.path))) !== file.sha256) problems.push(`State audit source changed ${file.path}`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = checkStateAudit(process.cwd());
    assert.deepEqual(problems, [], 'Regenerate the state candidate audit before admission');
    console.log('State candidate inventory matches its source, parser and ledger inputs.');
  } else console.log(JSON.stringify(writeStateAudit(process.cwd())));
}
