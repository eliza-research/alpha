import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const source = readFileSync('apps/app/src/prototype/dc-lite.js', 'utf8');
const start = source.indexOf('  function camel('), end = source.indexOf('  function props(');
assert.ok(start > 0 && end > start);
function renderer() {
  const dom = new JSDOM('');
  const context = vm.createContext({document: dom.window.document});
  vm.runInContext(`${source.slice(start, end)}\nglobalThis.parseStyle = parseStyle; globalThis.limit = STYLE_CACHE_LIMIT; globalThis.cache = styleCache;`, context);
  return context;
}

test('a repeated style string is parsed once and shared as a frozen object', () => {
  const {parseStyle} = renderer();
  const style = 'display: flex; padding: 4px 8px; background: url("data:image/png;base64,AA;BB"); --row: 2';
  const first = parseStyle(style);
  assert.deepEqual({...first}, {display: 'flex', paddingTop: '4px', paddingRight: '8px', paddingBottom: '4px', paddingLeft: '8px', background: 'url("data:image/png;base64,AA;BB")', '--row': '2'});
  assert.equal(parseStyle(style), first);
  assert.ok(Object.isFrozen(first));
  assert.notEqual(parseStyle('display: flex'), first);
  assert.equal(parseStyle(''), parseStyle(''));
});

test('interpolated styles cannot grow the cache past its limit', () => {
  const {parseStyle, limit, cache} = renderer();
  for (let height = 0; height < limit * 2 + 10; height++) {
    assert.deepEqual({...parseStyle(`height: ${height}px`)}, {height: `${height}px`});
    assert.ok(cache.size <= limit);
  }
  const kept = parseStyle('height: 1px');
  assert.equal(parseStyle('height: 1px'), kept);
});
