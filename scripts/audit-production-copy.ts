#!/usr/bin/env node
// Reports implementation terms (receipt, runtime, provider, MVP, vendor names, ...) in user-visible
// copy. Usage:
//   node scripts/audit-production-copy.ts [--lexicon <file>]
// Scans only copy: JSX text and visible JSX attributes, strings passed to known copy sinks
// (setMessage, setNotice, set*Error, toast, ...), DOM text assignments, strings returned by
// *Message() helpers and Error messages (errorMessage() passes them through) in apps/app/src,
// and Java strings passed to Toast and notification builders under android/app/src/main/java.
// Protocol keys and other data strings are not copy and are not read. Reviewed uses live in
// docs/production-copy-lexicon.json. Report mode: findings are printed and the exit code is 0;
// it is not part of audit:bundle until the owner reviews the first report.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseAst} from 'vite';
import type {Node} from '@oxc-project/types';
import {regularFiles} from './regular-files.ts';

type Parents = WeakMap<Node, Node>;
interface Copy {
  file: string;
  line: number;
  sink: string;
  text: string;
}
interface LexiconData {
  terms: {term: string; pattern: string; flags?: string}[];
  allow?: {term: string; text: string; file?: string}[];
  ignorePaths?: {path: string}[];
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

function* children(node: Node): Generator<Node> {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) yield child;
    } else if (isNode(value)) yield value;
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_LEXICON = path.join(ROOT, 'docs/production-copy-lexicon.json');
const WEB_ROOT = 'apps/app/src', JAVA_ROOT = 'android/app/src/main/java';

const SINK_CALL = /^(?:setMessage|setNotice|setError|setStatus|set[A-Z]\w*(?:Error|Notice|Message|Status)|toast|notice|showNotice|alert|confirm|announce)$/;
const SINK_PROPERTY = /^(?:message|error|notice|toast|detail|title|label|placeholder|ariaLabel|hint|body|description|summary|big|sub)$/;
// errorMessage() in runtime/connection-ui.tsx shows any other Error's message as it is.
const ERROR_CLASS = /^(?:Error|TypeError|RangeError|DOMException|\w+Error)$/;
const VISIBLE_ATTRIBUTE = /^(?:title|aria-label|aria-description|placeholder|alt|label)$/;
const DOM_TEXT = /^(?:textContent|innerText|title|placeholder|ariaLabel)$/;
const MESSAGE_FUNCTION = /Message$/;
const JAVA_SINK = /\b(?:Toast\.makeText|setContentTitle|setContentText|setSubText|setTicker|setBigContentTitle|setSummaryText|bigText|Action\.Builder)\s*\(/g;

/** Reads {terms, allow, ignorePaths}; terms are {term, pattern, flags}. */
export function readLexicon(file = DEFAULT_LEXICON) {
  const value: LexiconData = JSON.parse(readFileSync(file, 'utf8'));
  return {
    terms: value.terms.map(entry => ({term: entry.term, pattern: new RegExp(entry.pattern, entry.flags ?? 'i')})),
    allow: value.allow ?? [],
    ignorePaths: value.ignorePaths ?? [],
  };
}

// Prose has a space; single-word strings in sinks are keys or codes, not copy.
const prose = (text: string) => /\S\s+\S/.test(text);
const name = (node?: Node | null) => node?.type === 'Identifier' || node?.type === 'JSXIdentifier' ? node.name : node?.type === 'Literal' ? String(node.value) : '';
/** true for `testMocksEnabled` (alone or in an && chain), false for `!testMocksEnabled`, otherwise undefined. */
const testMocksCondition = (node: Node): boolean | undefined => {
  if (name(node) === 'testMocksEnabled') return true;
  if (node.type === 'UnaryExpression' && node.operator === '!' && name(node.argument) === 'testMocksEnabled') return false;
  if (node.type === 'LogicalExpression' && node.operator === '&&' && (testMocksCondition(node.left) === true || testMocksCondition(node.right) === true)) return true;
  return undefined;
};

/** Every string a copy expression can show: literal branches of ?:, ||, ??, &&, + and templates. */
function copyStrings(node: Node | null | undefined, out: {node: Node; text: string}[]) {
  if (!node) return out;
  switch (node.type) {
    case 'Literal': if (typeof node.value === 'string') out.push({node, text: node.value}); break;
    // Interpolations become gaps, so a term split across them is not reported.
    case 'TemplateLiteral':
      out.push({node, text: node.quasis.map(quasi => quasi.value.cooked ?? '').join(' … ')});
      for (const expression of node.expressions) copyStrings(expression, out);
      break;
    case 'ParenthesizedExpression': case 'TSAsExpression': case 'TSNonNullExpression': case 'TSSatisfiesExpression': case 'JSXExpressionContainer':
      copyStrings(node.expression, out); break;
    case 'ConditionalExpression': copyStrings(node.consequent, out); copyStrings(node.alternate, out); break;
    case 'LogicalExpression': if (node.operator !== '&&') copyStrings(node.left, out); copyStrings(node.right, out); break;
    case 'BinaryExpression': if (node.operator === '+') { copyStrings(node.left, out); copyStrings(node.right, out); } break;
    case 'ObjectExpression':
      for (const property of node.properties) if (property.type === 'Property' && SINK_PROPERTY.test(name(property.key))) copyStrings(property.value, out);
      break;
  }
  return out;
}

const calleeName = (callee: Node) => callee.type === 'MemberExpression' ? name(callee.property) : name(callee);
// Copy on a branch taken only when testMocksEnabled is true never reaches a production bundle.
const inTestMocksBranch = (node: Node, parents: Parents) => {
  for (let at = node, parent = parents.get(at); parent; at = parent, parent = parents.get(at)) {
    if ((parent.type === 'ConditionalExpression' || parent.type === 'IfStatement') && at !== parent.test && testMocksCondition(parent.test) === (at === parent.consequent)) return true;
    if (parent.type === 'LogicalExpression' && parent.operator === '&&' && at === parent.right && testMocksCondition(parent.left) === true) return true;
  }
  return false;
};

function enclosingFunctionName(node: Node, parents: Parents) {
  for (let at = parents.get(node); at; at = parents.get(at)) {
    if (at.type === 'FunctionDeclaration') return name(at.id);
    if (at.type === 'ArrowFunctionExpression' || at.type === 'FunctionExpression') {
      const parent = parents.get(at);
      if (parent?.type === 'VariableDeclarator') return name(parent.id);
      if (parent?.type === 'Property' || parent?.type === 'MethodDefinition' || parent?.type === 'PropertyDefinition') return name(parent.key);
      return at.type === 'FunctionExpression' ? name(at.id) || undefined : undefined;
    }
  }
  return undefined;
}

function indexParents(node: Node, parents: Parents) {
  for (const child of children(node)) {
    parents.set(child, node);
    indexParents(child, parents);
  }
}

/** The user-visible copy of one TypeScript, TSX or JavaScript source: [{file, line, sink, text}]. */
export function scanScriptSource(file: string, source: string) {
  const lang = file.endsWith('.tsx') ? 'tsx' : file.endsWith('.ts') ? 'ts' : 'jsx';
  const program = parseAst(source, {lang});
  const parents: Parents = new WeakMap();
  indexParents(program, parents);
  const copy: Copy[] = [];
  const add = (node: Node, text: string, sink: string, requireProse = true) => {
    const value = text.replace(/\s+/g, ' ').trim();
    if (!value || (requireProse && !prose(value)) || inTestMocksBranch(node, parents)) return;
    copy.push({file, line: source.slice(0, node.start).split('\n').length, sink, text: value});
  };
  const addAll = (expression: Node | undefined | null, sink: string) => { for (const item of copyStrings(expression, [])) add(item.node, item.text, sink); };
  const visit = (node: Node) => {
    switch (node.type) {
      case 'JSXText': add(node, node.value, 'jsx text', false); break;
      case 'JSXExpressionContainer':
        if (parents.get(node)?.type === 'JSXElement' || parents.get(node)?.type === 'JSXFragment') addAll(node.expression, 'jsx text');
        break;
      case 'JSXAttribute':
        if (VISIBLE_ATTRIBUTE.test(name(node.name)) && node.value) {
          if (node.value.type === 'Literal') add(node.value, String(node.value.value), `jsx ${name(node.name)}`, false);
          else addAll(node.value, `jsx ${name(node.name)}`);
        }
        break;
      case 'NewExpression':
        if (ERROR_CLASS.test(name(node.callee))) addAll(node.arguments[0], `new ${name(node.callee)}()`);
        break;
      case 'CallExpression': {
        const callee = calleeName(node.callee);
        // Error() and error factories such as speechError(code, message): codes are single words.
        if (SINK_CALL.test(callee) || (ERROR_CLASS.test(callee) && node.callee.type === 'Identifier')) for (const argument of node.arguments) addAll(argument, `${callee}()`);
        const [attribute, value] = node.arguments;
        if (callee === 'setAttribute' && attribute?.type === 'Literal' && VISIBLE_ATTRIBUTE.test(String(attribute.value))) addAll(value, `setAttribute(${attribute.value})`);
        break;
      }
      case 'AssignmentExpression':
        if (node.operator === '=' && node.left.type === 'MemberExpression' && DOM_TEXT.test(name(node.left.property))) addAll(node.right, `.${name(node.left.property)}`);
        break;
      case 'ArrowFunctionExpression': {
        const owner = node.expression && enclosingFunctionName(node.body, parents);
        if (owner && MESSAGE_FUNCTION.test(owner)) addAll(node.body, `${owner}()`);
        break;
      }
      case 'ReturnStatement': {
        const owner = enclosingFunctionName(node, parents);
        if (node.argument && owner && MESSAGE_FUNCTION.test(owner)) addAll(node.argument, `${owner}()`);
        break;
      }
    }
    for (const child of children(node)) visit(child);
  };
  visit(program);
  return copy;
}

/** The arguments' string literals of every Toast and notification builder call in one Java source. */
export function scanJavaSource(file: string, source: string) {
  const copy: Copy[] = [];
  for (const match of source.matchAll(JAVA_SINK)) {
    let depth = 1, at = match.index + match[0].length;
    while (at < source.length && depth > 0) {
      const char = source[at];
      if (char === '"') {
        let end = at + 1;
        while (end < source.length && source[end] !== '"') end += source[end] === '\\' ? 2 : 1;
        const text = source.slice(at + 1, end).replace(/\\(.)/g, (_, char) => 'ntr'.includes(char) ? ' ' : char);
        if (prose(text) || /^[A-Z]/.test(text)) copy.push({file, line: source.slice(0, at).split('\n').length, sink: match[0].replace(/\s*\($/, '()'), text});
        at = end + 1;
        continue;
      }
      if (char === '(') depth++;
      else if (char === ')') depth--;
      at++;
    }
  }
  return copy;
}

/** Every term in one piece of copy that no allow entry covers: [{file, line, sink, term, text}]. */
export function copyFindings(copy: Copy[], lexicon: ReturnType<typeof readLexicon>) {
  const findings: (Copy & {term: string})[] = [];
  for (const item of copy) {
    for (const {term, pattern} of lexicon.terms) {
      if (!pattern.test(item.text)) continue;
      const allowed = lexicon.allow.some(entry => entry.term === term && item.text.includes(entry.text) && (!entry.file || entry.file === item.file));
      if (!allowed) findings.push({...item, term});
    }
  }
  return findings;
}

/** Scans the product sources under root. */
export function auditProductionCopy({root = ROOT, lexicon = readLexicon()} = {}) {
  const relative = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const ignored = (file: string) => lexicon.ignorePaths.some(entry => file.startsWith(entry.path));
  const copy: Copy[] = [];
  for (const file of [...regularFiles(path.join(root, WEB_ROOT))].map(relative)) {
    if (!/\.(?:tsx?|jsx?|mjs)$/.test(file) || file.endsWith('.d.ts') || ignored(file)) continue;
    copy.push(...scanScriptSource(file, readFileSync(path.join(root, file), 'utf8')));
  }
  for (const file of [...regularFiles(path.join(root, JAVA_ROOT))].map(relative)) {
    if (!file.endsWith('.java') || ignored(file)) continue;
    copy.push(...scanJavaSource(file, readFileSync(path.join(root, file), 'utf8')));
  }
  return {copy: copy.length, findings: copyFindings(copy, lexicon)};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!(args.length === 0 || (args.length === 2 && args[0] === '--lexicon'))) {
    console.error('Usage: node scripts/audit-production-copy.ts [--lexicon <file>]');
    process.exit(2);
  }
  const result = auditProductionCopy({lexicon: readLexicon(args.length ? path.resolve(args[1]) : DEFAULT_LEXICON)});
  for (const finding of result.findings) console.log(`TERM ${finding.term} ${finding.file}:${finding.line} ${finding.sink} ${JSON.stringify(finding.text)}`);
  console.log(`REPORT ${result.findings.length} implementation term(s) in ${result.copy} pieces of user copy (report only; not a gate).`);
}
