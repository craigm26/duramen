// JSON text to a value, as JSON.parse reads it, on every engine duramen runs on.
//
// The JSON.parse of V8 13 and 14 (Node.js 24 and 26) misreads some escaped keys (DESIGN.md,
// "Node.js versions"; `jsonParseMisreadsKeys` in driver.mjs). On such an engine a text that holds
// a backslash, the only way a key can hold an escape, is read here instead: objects are built
// member by member, and only strings, which the bug does not touch, go through JSON.parse. On
// every other engine, and for every text without a backslash, this is JSON.parse.
//
// The value is the one JSON.parse gives: members are defined, not assigned (so "__proto__" is an
// own member), a repeated name keeps its first place and its last value, and a malformed text
// throws a SyntaxError.

let misreads;
function engineMisreads() {
  if (misreads === undefined) {
    // One probe per escaped key, each a fresh two-member object after one with a "\\" key: the
    // misread follows that object shape, so a bug with a slightly different trigger is still seen.
    misreads = ['"', '\n', '\u0000', '\u001f'].some((k, n) => {
      const p = `duramen.json.probe.${process.pid}.${Date.now()}.${n}`;
      JSON.parse(`{${JSON.stringify(p)}:0,"\\\\":0}`);
      return Object.keys(JSON.parse(`{${JSON.stringify(p)}:0,${JSON.stringify(k)}:0}`))[1] !== k;
    });
  }
  return misreads;
}

export function parseJson(text) {
  text = String(text);
  return text.includes('\\') && engineMisreads() ? readJson(text) : JSON.parse(text);
}

// The reader itself, on any text and any engine (the tests compare it with JSON.parse).
export function readJson(text) {
  text = String(text);
  let i = 0;
  const fail = (what) => { throw new SyntaxError(`${what} in JSON at position ${i}`); };
  const ws = () => { for (let c; (c = text.charCodeAt(i)) === 32 || c === 9 || c === 10 || c === 13;) i++; };
  const string = () => {
    const start = i++;
    for (;;) {
      if (i >= text.length) fail('Unterminated string');
      const c = text.charCodeAt(i);
      if (c === 34) break;
      if (c === 92) i++;
      i++;
    }
    i++;
    try { return JSON.parse(text.slice(start, i)); } catch { i = start; return fail('Bad string'); }
  };
  const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  const value = () => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const o = {};
      ws();
      if (text[i] === '}') { i++; return o; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('Expected property name');
        const k = string();
        ws();
        if (text[i] !== ':') fail("Expected ':' after property name");
        i++;
        Object.defineProperty(o, k, { value: value(), writable: true, enumerable: true, configurable: true });
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return o; }
        fail("Expected ',' or '}' after property value");
      }
    }
    if (c === '[') {
      i++;
      const a = [];
      ws();
      if (text[i] === ']') { i++; return a; }
      for (;;) {
        a.push(value());
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return a; }
        fail("Expected ',' or ']' after array element");
      }
    }
    if (c === '"') return string();
    for (const [word, v] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, i)) { i += word.length; return v; }
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m) { i += m[0].length; return Number(m[0]); }
    return fail(i >= text.length ? 'Unexpected end of JSON input' : `Unexpected token '${text[i]}'`);
  };
  const v = value();
  ws();
  if (i < text.length) fail('Unexpected non-whitespace character after JSON');
  return v;
}
