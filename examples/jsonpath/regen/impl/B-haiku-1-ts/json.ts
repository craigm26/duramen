// JSON values. The parser keeps member order (objects are Maps), keeps the
// text of every number, and rejects anything RFC 8259 rejects.

export class JNum {
  readonly text: string;
  readonly n: number;

  constructor(text: string, n: number) {
    this.text = text;
    this.n = n;
  }
}

export type JVal = null | boolean | string | JNum | JVal[] | Map<string, JVal>;

export class JsonError extends Error {}

const NUMBER = /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;

export function parseJson(text: string): JVal {
  let i = 0;
  const fail = (): never => {
    throw new JsonError(`invalid JSON at ${i}`);
  };
  const ws = (): void => {
    while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r') i++;
  };
  const str = (): string => {
    i++;
    let out = '';
    for (;;) {
      const c = text[i];
      if (c === undefined) fail();
      if (c === '"') {
        i++;
        return out;
      }
      if (c === '\\') {
        const e = text[i + 1];
        i += 2;
        switch (e) {
          case '"':
          case '\\':
          case '/':
            out += e;
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const h = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) fail();
            out += String.fromCharCode(parseInt(h, 16));
            i += 4;
            break;
          }
          default:
            fail();
        }
        continue;
      }
      if (c < ' ') fail();
      out += c;
      i++;
    }
  };
  const scalar = (): JVal => {
    const c = text[i];
    if (c === '"') return str();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m === null) return fail();
    i = NUMBER.lastIndex;
    return new JNum(m[0], Number(m[0]));
  };
  // The member name and colon that start an object member.
  const memberKey = (): string => {
    ws();
    if (text[i] !== '"') fail();
    const k = str();
    ws();
    if (text[i] !== ':') fail();
    i++;
    return k;
  };
  // Open containers, innermost last. Nesting is kept on this stack, not in recursion,
  // so the depth of a document is not limited by the call stack.
  const open: Frame[] = [];
  let value: JVal;
  for (;;) {
    ws();
    if (text[i] === '{') {
      i++;
      ws();
      if (text[i] === '}') {
        i++;
        value = new Map<string, JVal>();
      } else {
        open.push({ m: new Map<string, JVal>(), a: null, key: memberKey() });
        continue;
      }
    } else if (text[i] === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        value = [];
      } else {
        open.push({ m: null, a: [], key: '' });
        continue;
      }
    } else {
      value = scalar();
    }
    // Give the finished value to its parent; close containers that end here.
    for (;;) {
      const top: Frame | undefined = open[open.length - 1];
      if (top === undefined) {
        ws();
        if (i !== text.length) fail();
        return value;
      }
      if (top.m !== null) {
        top.m.set(top.key, value);
      } else {
        (top.a as JVal[]).push(value);
      }
      ws();
      if (text[i] === ',') {
        i++;
        if (top.m !== null) top.key = memberKey();
        break;
      }
      if (text[i] !== (top.m !== null ? '}' : ']')) fail();
      i++;
      open.pop();
      value = top.m !== null ? top.m : (top.a as JVal[]);
    }
  }
}

interface Frame {
  m: Map<string, JVal> | null; // an object being read, or null
  a: JVal[] | null; // an array being read, or null
  key: string; // the member name whose value is being read
}

type Task = { lit: string } | { val: JVal };

// Serializes a value as JSON text on one line. Numbers keep their original text.
export function toJson(v: JVal): string {
  const out: string[] = [];
  const todo: Task[] = [{ val: v }];
  while (todo.length > 0) {
    const t = todo.pop() as Task;
    if ('lit' in t) {
      out.push(t.lit);
      continue;
    }
    const x = t.val;
    if (x === null) {
      out.push('null');
    } else if (typeof x === 'boolean') {
      out.push(x ? 'true' : 'false');
    } else if (typeof x === 'string') {
      out.push(JSON.stringify(x));
    } else if (x instanceof JNum) {
      out.push(x.text);
    } else if (Array.isArray(x)) {
      out.push('[');
      todo.push({ lit: ']' });
      for (let k = x.length - 1; k >= 0; k--) {
        todo.push({ val: x[k] });
        if (k > 0) todo.push({ lit: ',' });
      }
    } else {
      const entries = [...x.entries()];
      out.push('{');
      todo.push({ lit: '}' });
      for (let k = entries.length - 1; k >= 0; k--) {
        todo.push({ val: entries[k][1] });
        todo.push({ lit: JSON.stringify(entries[k][0]) + ':' });
        if (k > 0) todo.push({ lit: ',' });
      }
    }
  }
  return out.join('');
}
